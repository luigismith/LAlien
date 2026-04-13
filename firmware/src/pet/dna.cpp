/**
 * dna.cpp — Phonetic DNA: sensor data at hatching -> SHA-256 -> visual + personality params
 * Collects 3 seconds of IMU, mic, and light sensor data, hashes it to create
 * a unique and immutable DNA for each pet.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "dna.h"
#include "../hal/imu.h"
#include "../hal/mic.h"
#include "../hal/light.h"
#include "personality.h"
#include "mbedtls/sha256.h"

namespace Pet {
namespace DNA {

// Number of samples at 10Hz over 3 seconds
static constexpr uint8_t SAMPLE_COUNT = 30;

DNAData generate() {
    DNAData dna;
    memset(&dna, 0, sizeof(dna));

    // Buffer to collect all sensor data for hashing
    // 30 samples * 6 floats (accel xyz + gyro xyz) = 720 bytes
    // 30 mic level floats = 120 bytes
    // 4 uint16_t light values = 8 bytes
    // 1 uint32_t timestamp = 4 bytes
    // Total: ~852 bytes
    static constexpr size_t BUF_SIZE = (SAMPLE_COUNT * 6 * sizeof(float))
                                     + (SAMPLE_COUNT * sizeof(float))
                                     + (4 * sizeof(uint16_t))
                                     + sizeof(uint32_t);
    uint8_t buf[BUF_SIZE];
    size_t offset = 0;

    // Collect IMU and mic samples at ~10Hz (100ms intervals)
    for (uint8_t i = 0; i < SAMPLE_COUNT; i++) {
        HAL::IMU::poll();
        HAL::Mic::pollLevel();

        float ax = HAL::IMU::getAccelX();
        float ay = HAL::IMU::getAccelY();
        float az = HAL::IMU::getAccelZ();
        float gx = HAL::IMU::getGyroX();
        float gy = HAL::IMU::getGyroY();
        float gz = HAL::IMU::getGyroZ();

        memcpy(buf + offset, &ax, sizeof(float)); offset += sizeof(float);
        memcpy(buf + offset, &ay, sizeof(float)); offset += sizeof(float);
        memcpy(buf + offset, &az, sizeof(float)); offset += sizeof(float);
        memcpy(buf + offset, &gx, sizeof(float)); offset += sizeof(float);
        memcpy(buf + offset, &gy, sizeof(float)); offset += sizeof(float);
        memcpy(buf + offset, &gz, sizeof(float)); offset += sizeof(float);

        float mic_level = HAL::Mic::getLevel();
        memcpy(buf + offset, &mic_level, sizeof(float)); offset += sizeof(float);

        // Non-blocking wait ~100ms using millis() polling
        uint32_t wait_start = millis();
        while (millis() - wait_start < 100) {
            // Yield to other tasks but don't use delay()
            yield();
        }
    }

    // Sample light sensor once
    HAL::Light::poll();
    HAL::Light::LightReading light = HAL::Light::getReading();
    memcpy(buf + offset, &light.ambient, sizeof(uint16_t)); offset += sizeof(uint16_t);
    memcpy(buf + offset, &light.r, sizeof(uint16_t)); offset += sizeof(uint16_t);
    memcpy(buf + offset, &light.g, sizeof(uint16_t)); offset += sizeof(uint16_t);
    memcpy(buf + offset, &light.b, sizeof(uint16_t)); offset += sizeof(uint16_t);

    // Add millis() timestamp for extra entropy
    uint32_t ts = millis();
    memcpy(buf + offset, &ts, sizeof(uint32_t)); offset += sizeof(uint32_t);

    // Compute SHA-256 hash
    mbedtls_sha256_context ctx;
    mbedtls_sha256_init(&ctx);
    mbedtls_sha256_starts(&ctx, 0); // 0 = SHA-256 (not SHA-224)
    mbedtls_sha256_update(&ctx, buf, offset);
    mbedtls_sha256_finish(&ctx, dna.hash);
    mbedtls_sha256_free(&ctx);

    // Derive visual/personality parameters from hash
    deriveParams(dna);

    return dna;
}

void deriveParams(DNAData& dna) {
    dna.variant_index     = dna.hash[0] % 16;
    dna.appendage_count   = dna.hash[1] % 7;      // 0-6
    dna.appendage_length  = dna.hash[2] % 4;      // 0-3
    dna.eye_size          = dna.hash[3] % 4;      // 0-3
    dna.core_pattern      = dna.hash[4] % 8;      // 0-7
    dna.body_curvature    = dna.hash[5] % 4;      // 0-3
    dna.palette_warmth    = dna.hash[6];           // 0-255
    dna.personality_traits = dna.hash[7] & 0x1F;   // 5 bits for 5 traits
    dna.core_hue          = ((uint16_t)(dna.hash[8]) << 8 | dna.hash[9]) % 360;
}

DNAData fromHash(const uint8_t* hash) {
    DNAData dna;
    memcpy(dna.hash, hash, DNA_HASH_LEN);
    deriveParams(dna);
    return dna;
}

String getPersonalityDescription(const DNAData& dna) {
    return Personality::buildPromptBlock(dna);
}

} // namespace DNA
} // namespace Pet
