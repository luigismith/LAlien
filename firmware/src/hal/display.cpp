/**
 * display.cpp — Display HAL implementation
 * Uses Arduino_H7_Video for GIGA Display Shield + LVGL 9.x
 * Author: Claude Code | Date: 2026-04-13
 */
#include "display.h"
#include "Arduino_H7_Video.h"
#include "SDRAM.h"
#include "lvgl.h"

// GIGA Display Shield: 800x480, 16-bit color
static Arduino_H7_Video display(HAL::Display::WIDTH, HAL::Display::HEIGHT, GigaDisplayShield);
static uint16_t* framebuffer = nullptr;
static bool initialized = false;

// LVGL display buffer
static lv_display_t* lv_disp = nullptr;

// LVGL flush callback
static void lvgl_flush_cb(lv_display_t* disp, const lv_area_t* area, uint8_t* px_map) {
    uint16_t* buf = (uint16_t*)px_map;
    uint32_t w = area->x2 - area->x1 + 1;
    uint32_t h = area->y2 - area->y1 + 1;

    for (uint32_t y = 0; y < h; y++) {
        memcpy(&framebuffer[(area->y1 + y) * HAL::Display::WIDTH + area->x1],
               &buf[y * w],
               w * sizeof(uint16_t));
    }

    lv_display_flush_ready(disp);
}

namespace HAL {
namespace Display {

void init() {
    // Init SDRAM for framebuffer
    SDRAM.begin();
    framebuffer = (uint16_t*)SDRAM.malloc(WIDTH * HEIGHT * sizeof(uint16_t));
    if (!framebuffer) {
        Serial.println("[DISPLAY] SDRAM alloc failed!");
        return;
    }
    memset(framebuffer, 0, WIDTH * HEIGHT * sizeof(uint16_t));

    // Init video output
    display.begin();

    // Init LVGL
    lv_init();

    // Create LVGL display with draw buffers in SDRAM
    static uint16_t* draw_buf1 = (uint16_t*)SDRAM.malloc(WIDTH * 60 * sizeof(uint16_t));
    static uint16_t* draw_buf2 = (uint16_t*)SDRAM.malloc(WIDTH * 60 * sizeof(uint16_t));

    lv_disp = lv_display_create(WIDTH, HEIGHT);
    lv_display_set_flush_cb(lv_disp, lvgl_flush_cb);
    lv_display_set_buffers(lv_disp, draw_buf1, draw_buf2,
                           WIDTH * 60 * sizeof(uint16_t),
                           LV_DISPLAY_RENDER_MODE_PARTIAL);

    initialized = true;
    Serial.println("[DISPLAY] OK — 800x480, LVGL 9.x ready");
}

uint16_t* getFramebuffer() {
    return framebuffer;
}

void setBacklight(uint8_t brightness) {
    // GIGA Display Shield backlight is always on; placeholder for future
    (void)brightness;
}

bool isReady() {
    return initialized;
}

} // namespace Display
} // namespace HAL
