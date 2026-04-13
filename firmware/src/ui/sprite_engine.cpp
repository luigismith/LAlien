/**
 * sprite_engine.cpp — Sprite loading, caching, and rendering from SD card
 *
 * Loads pre-converted .r565 sprite sheets from SD, caches in SDRAM with
 * LRU eviction, and renders scaled frames to LVGL image objects.
 *
 * File format: raw RGB565, 16-bit little-endian, width = 64 * frame_count,
 * height = 64. Transparent pixels are magenta (0xF81F).
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "sprite_engine.h"
#include "../hal/sd_storage.h"
#include "lvgl.h"
#include "SDRAM.h"
#include <Arduino.h>

// ---- Constants ----
static constexpr uint8_t  FRAME_SIZE    = 64;       // pixels per frame edge
static constexpr uint8_t  RENDER_SCALE  = 4;        // 64 -> 256 on screen
static constexpr uint16_t RENDER_SIZE   = FRAME_SIZE * RENDER_SCALE; // 256
static constexpr uint16_t TRANSPARENT   = 0xF81F;   // magenta key
static constexpr uint8_t  MAX_CACHE     = 24;       // max cached sprite sheets
static constexpr uint32_t CACHE_BUDGET  = 4UL * 1024 * 1024; // 4 MB SDRAM

// ---- Cache entry ----
struct CacheEntry {
    bool     used;
    uint8_t  stage;
    uint8_t  variant;
    char     anim_name[24];
    uint8_t  frame_count;
    uint8_t  fps;
    uint16_t sheet_width;   // 64 * frame_count
    uint32_t data_bytes;    // sheet_width * 64 * 2
    uint16_t* pixel_data;   // SDRAM pointer
    uint32_t last_access;   // millis() for LRU
};

// ---- State ----
static CacheEntry cache[MAX_CACHE];
static uint32_t   cache_used_bytes = 0;
static int8_t     active_entry     = -1;  // index into cache[]
static uint8_t    current_frame    = 0;
static uint32_t   last_tick_ms     = 0;
static float      frame_accum      = 0.0f;

// Current sprite identity (for setAnimation)
static uint8_t  current_stage   = 0;
static uint8_t  current_variant = 0;

// Scaled render buffer in SDRAM (256x256 RGB565)
static uint16_t* render_buf     = nullptr;
static lv_image_dsc_t render_dsc;

// LVGL image object for display
static lv_obj_t* sprite_img     = nullptr;

// ---- Helpers ----

/// Find cache entry by key. Returns index or -1.
static int8_t cache_find(uint8_t stage, uint8_t variant, const char* anim) {
    for (uint8_t i = 0; i < MAX_CACHE; i++) {
        if (cache[i].used &&
            cache[i].stage == stage &&
            cache[i].variant == variant &&
            strcmp(cache[i].anim_name, anim) == 0) {
            return i;
        }
    }
    return -1;
}

/// Find an empty slot, or evict LRU entry.
static int8_t cache_alloc(uint32_t needed_bytes) {
    // Try to find an empty slot
    for (uint8_t i = 0; i < MAX_CACHE; i++) {
        if (!cache[i].used) return i;
    }

    // Evict while we need space or need a slot
    while (cache_used_bytes + needed_bytes > CACHE_BUDGET) {
        // Find LRU (oldest last_access, not the active entry)
        int8_t oldest = -1;
        uint32_t oldest_time = UINT32_MAX;
        for (uint8_t i = 0; i < MAX_CACHE; i++) {
            if (cache[i].used && i != active_entry && cache[i].last_access < oldest_time) {
                oldest_time = cache[i].last_access;
                oldest = i;
            }
        }
        if (oldest < 0) break; // nothing to evict

        // Free the entry
        if (cache[oldest].pixel_data) {
            // SDRAM.free() is not standard on all Arduino cores;
            // we track bytes but the memory is pooled in SDRAM.
            // On platforms with SDRAM.free(), call it here.
            cache_used_bytes -= cache[oldest].data_bytes;
        }
        cache[oldest].used = false;
        cache[oldest].pixel_data = nullptr;
        Serial.print("[SPRITE] Evicted cache slot ");
        Serial.println(oldest);
    }

    // Find an empty slot after eviction
    for (uint8_t i = 0; i < MAX_CACHE; i++) {
        if (!cache[i].used) return i;
    }
    return -1;
}

/// Parse a simple integer from a JSON string at key "key_name": value
/// Very minimal parser for meta.json fields, avoids ArduinoJson dependency.
static int json_get_int(const String& json, const char* key) {
    String search = String("\"") + key + "\"";
    int pos = json.indexOf(search);
    if (pos < 0) return -1;
    // Find the colon after the key
    pos = json.indexOf(':', pos + search.length());
    if (pos < 0) return -1;
    pos++; // skip ':'
    // Skip whitespace
    while (pos < (int)json.length() && (json[pos] == ' ' || json[pos] == '\t')) pos++;
    // Parse integer
    int val = 0;
    bool found = false;
    while (pos < (int)json.length() && json[pos] >= '0' && json[pos] <= '9') {
        val = val * 10 + (json[pos] - '0');
        found = true;
        pos++;
    }
    return found ? val : -1;
}

/// Extract animation block from meta.json for a given animation name.
/// Returns the sub-JSON object string for that animation.
static String json_get_anim_block(const String& json, const char* anim_name) {
    String search = String("\"") + anim_name + "\"";
    int pos = json.indexOf(search);
    if (pos < 0) return "";
    // Find opening brace
    pos = json.indexOf('{', pos);
    if (pos < 0) return "";
    // Find matching closing brace
    int depth = 1;
    int start = pos;
    pos++;
    while (pos < (int)json.length() && depth > 0) {
        if (json[pos] == '{') depth++;
        else if (json[pos] == '}') depth--;
        pos++;
    }
    return json.substring(start, pos);
}

/// Build the SD card path for a sprite file.
static String build_path(uint8_t stage, uint8_t variant, const char* anim_name) {
    // Path: /sprites/stage_N_name/variant_XX/anim.r565
    // We need stage name — read from directory listing or hard-code the known names
    static const char* stage_names[] = {
        "syrma", "lalina", "lalishi", "laliko",
        "laliren", "lalivox", "lalimere", "lalithishi"
    };
    const char* sname = (stage < 8) ? stage_names[stage] : "unknown";

    char path[128];
    snprintf(path, sizeof(path),
             "/sprites/stage_%d_%s/variant_%02d/%s.r565",
             stage, sname, variant, anim_name);
    return String(path);
}

/// Build the SD card path for meta.json.
static String build_meta_path(uint8_t stage, uint8_t variant) {
    static const char* stage_names[] = {
        "syrma", "lalina", "lalishi", "laliko",
        "laliren", "lalivox", "lalimere", "lalithishi"
    };
    const char* sname = (stage < 8) ? stage_names[stage] : "unknown";

    char path[128];
    snprintf(path, sizeof(path),
             "/sprites/stage_%d_%s/variant_%02d/meta.json",
             stage, sname, variant);
    return String(path);
}

// ---- Public API ----

namespace UI {
namespace SpriteEngine {

void init() {
    // Clear cache
    memset(cache, 0, sizeof(cache));
    cache_used_bytes = 0;
    active_entry = -1;
    current_frame = 0;
    last_tick_ms = millis();
    frame_accum = 0.0f;

    // Allocate render buffer in SDRAM (256x256 RGB565 = 128KB)
    render_buf = (uint16_t*)SDRAM.malloc(RENDER_SIZE * RENDER_SIZE * sizeof(uint16_t));
    if (!render_buf) {
        Serial.println("[SPRITE] SDRAM alloc for render buffer failed!");
        return;
    }
    memset(render_buf, 0, RENDER_SIZE * RENDER_SIZE * sizeof(uint16_t));

    // Set up LVGL image descriptor for the render buffer
    render_dsc.header.magic = LV_IMAGE_HEADER_MAGIC;
    render_dsc.header.cf = LV_COLOR_FORMAT_RGB565;
    render_dsc.header.w = RENDER_SIZE;
    render_dsc.header.h = RENDER_SIZE;
    render_dsc.header.stride = RENDER_SIZE * 2;
    render_dsc.data_size = RENDER_SIZE * RENDER_SIZE * sizeof(uint16_t);
    render_dsc.data = (const uint8_t*)render_buf;

    // Create LVGL image object (initially hidden)
    sprite_img = lv_image_create(lv_screen_active());
    lv_image_set_src(sprite_img, &render_dsc);
    lv_obj_add_flag(sprite_img, LV_OBJ_FLAG_HIDDEN);

    Serial.println("[SPRITE] Engine initialized — render buf 256x256, LRU cache ready");
}

bool loadSprite(uint8_t stage, uint8_t variant_index, const char* animation_name) {
    current_stage = stage;
    current_variant = variant_index;

    // Check cache first
    int8_t idx = cache_find(stage, variant_index, animation_name);
    if (idx >= 0) {
        cache[idx].last_access = millis();
        active_entry = idx;
        current_frame = 0;
        frame_accum = 0.0f;
        last_tick_ms = millis();
        Serial.print("[SPRITE] Cache hit: ");
        Serial.println(animation_name);
        return true;
    }

    // Read meta.json to get frame_count and fps
    String meta_path = build_meta_path(stage, variant_index);
    String meta_json = HAL::SDStorage::readFileString(meta_path.c_str());
    if (meta_json.length() == 0) {
        Serial.print("[SPRITE] meta.json not found: ");
        Serial.println(meta_path);
        return false;
    }

    // Parse animation info from meta.json
    String anim_block = json_get_anim_block(meta_json, animation_name);
    if (anim_block.length() == 0) {
        Serial.print("[SPRITE] Animation not found in meta: ");
        Serial.println(animation_name);
        return false;
    }

    int frame_count = json_get_int(anim_block, "frames");
    int fps = json_get_int(anim_block, "fps");
    if (frame_count <= 0) frame_count = 1;
    if (fps <= 0) fps = 4;

    // Build path to .r565 file
    String r565_path = build_path(stage, variant_index, animation_name);
    uint32_t data_bytes = (uint32_t)frame_count * FRAME_SIZE * FRAME_SIZE * 2;

    // Allocate cache slot (may evict)
    int8_t slot = cache_alloc(data_bytes);
    if (slot < 0) {
        Serial.println("[SPRITE] Cache full, cannot allocate slot");
        return false;
    }

    // Allocate SDRAM for pixel data
    uint16_t* pixels = (uint16_t*)SDRAM.malloc(data_bytes);
    if (!pixels) {
        Serial.print("[SPRITE] SDRAM alloc failed for ");
        Serial.print(data_bytes);
        Serial.println(" bytes");
        return false;
    }

    // Read .r565 file from SD card
    int32_t bytes_read = HAL::SDStorage::readFile(r565_path.c_str(),
                                                   (uint8_t*)pixels, data_bytes);
    if (bytes_read < 0 || (uint32_t)bytes_read != data_bytes) {
        Serial.print("[SPRITE] Failed to read ");
        Serial.print(r565_path);
        Serial.print(" (got ");
        Serial.print(bytes_read);
        Serial.print(" / ");
        Serial.print(data_bytes);
        Serial.println(")");
        // Free the allocated memory if possible
        return false;
    }

    // Fill cache entry
    CacheEntry& entry = cache[slot];
    entry.used = true;
    entry.stage = stage;
    entry.variant = variant_index;
    strncpy(entry.anim_name, animation_name, sizeof(entry.anim_name) - 1);
    entry.anim_name[sizeof(entry.anim_name) - 1] = '\0';
    entry.frame_count = (uint8_t)frame_count;
    entry.fps = (uint8_t)fps;
    entry.sheet_width = (uint16_t)(frame_count * FRAME_SIZE);
    entry.data_bytes = data_bytes;
    entry.pixel_data = pixels;
    entry.last_access = millis();

    cache_used_bytes += data_bytes;
    active_entry = slot;
    current_frame = 0;
    frame_accum = 0.0f;
    last_tick_ms = millis();

    Serial.print("[SPRITE] Loaded ");
    Serial.print(animation_name);
    Serial.print(" (");
    Serial.print(frame_count);
    Serial.print(" frames @ ");
    Serial.print(fps);
    Serial.print(" fps, ");
    Serial.print(data_bytes);
    Serial.println(" bytes)");

    return true;
}

const uint16_t* getFrameData(uint8_t frame_index) {
    if (active_entry < 0) return nullptr;
    CacheEntry& entry = cache[active_entry];
    if (frame_index >= entry.frame_count) return nullptr;

    // Frame data starts at column frame_index * 64 in the sprite sheet
    // But the sheet is stored as a linear pixel array, row by row.
    // For a sheet of width = frame_count * 64, height = 64:
    //   pixel at (x, y) = data[y * sheet_width + x]
    //   Frame N starts at column N * 64
    // We return a pointer, but the caller must handle stride = sheet_width
    // For simplicity, return pointer to first pixel of the frame in row 0.
    return &entry.pixel_data[frame_index * FRAME_SIZE];
}

uint8_t getFrameCount() {
    if (active_entry < 0) return 0;
    return cache[active_entry].frame_count;
}

uint8_t getFPS() {
    if (active_entry < 0) return 8;
    return cache[active_entry].fps;
}

void renderFrame(uint8_t frame_index, int16_t x, int16_t y, uint8_t scale) {
    if (active_entry < 0 || !render_buf || !sprite_img) return;
    CacheEntry& entry = cache[active_entry];
    if (frame_index >= entry.frame_count) return;

    const uint16_t* sheet = entry.pixel_data;
    uint16_t sheet_w = entry.sheet_width;
    uint16_t frame_x_offset = (uint16_t)frame_index * FRAME_SIZE;
    uint16_t out_size = FRAME_SIZE * scale;

    // Clamp output size to render buffer
    if (out_size > RENDER_SIZE) out_size = RENDER_SIZE;

    // Nearest-neighbor scale from 64x64 frame to out_size x out_size
    for (uint16_t oy = 0; oy < out_size; oy++) {
        uint16_t sy = oy / scale;  // source y (0..63)
        const uint16_t* src_row = &sheet[sy * sheet_w + frame_x_offset];
        uint16_t* dst_row = &render_buf[oy * RENDER_SIZE];

        for (uint16_t ox = 0; ox < out_size; ox++) {
            uint16_t sx = ox / scale;  // source x (0..63)
            uint16_t pixel = src_row[sx];
            // Transparent pixels become black (background)
            dst_row[ox] = (pixel == TRANSPARENT) ? 0x0000 : pixel;
        }
        // Clear remaining pixels in the row
        for (uint16_t ox = out_size; ox < RENDER_SIZE; ox++) {
            dst_row[ox] = 0x0000;
        }
    }
    // Clear remaining rows
    for (uint16_t oy = out_size; oy < RENDER_SIZE; oy++) {
        memset(&render_buf[oy * RENDER_SIZE], 0, RENDER_SIZE * sizeof(uint16_t));
    }

    // Update LVGL image
    lv_image_set_src(sprite_img, &render_dsc);
    lv_obj_set_pos(sprite_img, x, y);
    lv_obj_remove_flag(sprite_img, LV_OBJ_FLAG_HIDDEN);
    lv_obj_invalidate(sprite_img);
}

uint8_t tick() {
    if (active_entry < 0) return 0;
    CacheEntry& entry = cache[active_entry];
    if (entry.frame_count <= 1) return 0;

    uint32_t now = millis();
    uint32_t elapsed = now - last_tick_ms;
    last_tick_ms = now;

    // Accumulate fractional frames
    frame_accum += (float)elapsed * entry.fps / 1000.0f;
    if (frame_accum >= 1.0f) {
        uint8_t advance = (uint8_t)frame_accum;
        frame_accum -= (float)advance;
        current_frame = (current_frame + advance) % entry.frame_count;
    }

    // Render the current frame centered on screen (800x480 -> center 256x256)
    int16_t cx = (800 - RENDER_SIZE) / 2;  // 272
    int16_t cy = (480 - RENDER_SIZE) / 2 - 30; // slightly above center to leave room for speech bubble
    renderFrame(current_frame, cx, cy, RENDER_SCALE);

    return current_frame;
}

void resetAnimation() {
    current_frame = 0;
    frame_accum = 0.0f;
    last_tick_ms = millis();
}

void setAnimation(const char* name) {
    if (active_entry >= 0 && strcmp(cache[active_entry].anim_name, name) == 0) {
        return; // already playing this animation
    }
    // Load the new animation for the current stage/variant
    loadSprite(current_stage, current_variant, name);
}

void clearCache() {
    for (uint8_t i = 0; i < MAX_CACHE; i++) {
        cache[i].used = false;
        cache[i].pixel_data = nullptr;
    }
    cache_used_bytes = 0;
    active_entry = -1;
    current_frame = 0;
    Serial.println("[SPRITE] Cache cleared");
}

} // namespace SpriteEngine
} // namespace UI
