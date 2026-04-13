/**
 * sd_storage.cpp — microSD HAL implementation using SD library (mbed core)
 * Author: Claude Code | Date: 2026-04-13
 */
#include "sd_storage.h"
#include <SD.h>

static bool sd_ready = false;

namespace HAL {
namespace SDStorage {

void init() {
    if (SD.begin()) {
        sd_ready = true;
        Serial.println("[SD] OK — microSD ready");

        // Ensure base directory structure exists
        if (!SD.exists("/lalien")) {
            SD.mkdir("/lalien");
            SD.mkdir("/lalien/pets");
            SD.mkdir("/lalien/pets/current");
            SD.mkdir("/lalien/graveyard");
            SD.mkdir("/lalien/sprites");
            SD.mkdir("/lalien/lang");
            SD.mkdir("/lalien/lore");
            SD.mkdir("/lalien/logs");
        }
    } else {
        Serial.println("[SD] FAIL — microSD not found");
    }
}

bool isReady() {
    return sd_ready;
}

bool fileExists(const char* path) {
    return sd_ready && SD.exists(path);
}

bool dirExists(const char* path) {
    if (!sd_ready) return false;
    File f = SD.open(path);
    if (!f) return false;
    bool is_dir = f.isDirectory();
    f.close();
    return is_dir;
}

bool mkdir(const char* path) {
    return sd_ready && SD.mkdir(path);
}

int32_t readFile(const char* path, uint8_t* buf, uint32_t max_len) {
    if (!sd_ready) return -1;
    File f = SD.open(path, FILE_READ);
    if (!f) return -1;
    int32_t bytes_read = f.read(buf, max_len);
    f.close();
    return bytes_read;
}

String readFileString(const char* path) {
    if (!sd_ready) return "";
    File f = SD.open(path, FILE_READ);
    if (!f) return "";
    String content = f.readString();
    f.close();
    return content;
}

bool writeFile(const char* path, const uint8_t* data, uint32_t len) {
    if (!sd_ready) return false;
    File f = SD.open(path, FILE_WRITE);
    if (!f) return false;
    // Truncate by seeking to 0
    f.seek(0);
    size_t written = f.write(data, len);
    f.close();
    return written == len;
}

bool writeFileString(const char* path, const String& data) {
    return writeFile(path, (const uint8_t*)data.c_str(), data.length());
}

bool appendFileString(const char* path, const String& data) {
    if (!sd_ready) return false;
    File f = SD.open(path, FILE_WRITE);
    if (!f) return false;
    f.seek(f.size()); // append
    f.print(data);
    f.close();
    return true;
}

bool deleteFile(const char* path) {
    return sd_ready && SD.remove(path);
}

bool renameFile(const char* from, const char* to) {
    return sd_ready && SD.rename(from, to);
}

uint64_t freeSpace() {
    // SD library on mbed doesn't expose free space easily.
    // Return 0 as placeholder; could use fatfs directly if needed.
    return 0;
}

} // namespace SDStorage
} // namespace HAL
