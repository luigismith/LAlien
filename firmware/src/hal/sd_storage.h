/**
 * sd_storage.h — microSD HAL for GIGA Display Shield
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace HAL {
namespace SDStorage {

    void init();
    bool isReady();

    bool fileExists(const char* path);
    bool dirExists(const char* path);
    bool mkdir(const char* path);

    /// Read entire file into buffer. Returns bytes read, -1 on error.
    int32_t readFile(const char* path, uint8_t* buf, uint32_t max_len);

    /// Read file as String. Returns empty on error.
    String readFileString(const char* path);

    /// Write entire buffer to file (overwrite). Returns true on success.
    bool writeFile(const char* path, const uint8_t* data, uint32_t len);

    /// Write string to file.
    bool writeFileString(const char* path, const String& data);

    /// Append string to file.
    bool appendFileString(const char* path, const String& data);

    /// Delete file. Returns true on success.
    bool deleteFile(const char* path);

    /// Rename / move file.
    bool renameFile(const char* from, const char* to);

    /// Free space on SD in bytes.
    uint64_t freeSpace();

} // namespace SDStorage
} // namespace HAL
