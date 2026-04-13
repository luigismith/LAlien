/**
 * crypto.cpp — AES-128-ECB encryption for API key protection on SD card
 * Uses mbedtls AES from the mbed core. Key is derived from the STM32
 * MCU unique ID (96 bits) XOR with a fixed salt to produce a 128-bit key.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "crypto.h"
#include "mbedtls/aes.h"
#include <Arduino.h>

namespace Crypto {

// AES-128 key length
static constexpr uint8_t KEY_LEN = 16;
static constexpr uint8_t BLOCK_SIZE = 16;

// Fixed salt (compile-time constant, change per deployment)
static const uint8_t SALT[KEY_LEN] = {
    0x4C, 0x41, 0x4C, 0x49, 0x45, 0x4E, 0x5F, 0x53,  // "LALIEN_S"
    0x41, 0x4C, 0x54, 0x5F, 0x4B, 0x45, 0x59, 0x21   // "ALT_KEY!"
};

// Derived key (computed once at init)
static uint8_t s_key[KEY_LEN];
static bool s_initialized = false;

// STM32 Unique Device ID register addresses (96 bits = 12 bytes)
// On STM32H7 (GIGA R1): 0x1FF1E800
static constexpr uint32_t UID_BASE_ADDR = 0x1FF1E800;

static void readMCUUniqueID(uint8_t* uid12) {
    // Read 96-bit unique ID from STM32 OTP memory
    volatile uint32_t* uid = (volatile uint32_t*)UID_BASE_ADDR;
    uint32_t w0 = uid[0];
    uint32_t w1 = uid[1];
    uint32_t w2 = uid[2];

    memcpy(uid12,     &w0, 4);
    memcpy(uid12 + 4, &w1, 4);
    memcpy(uid12 + 8, &w2, 4);
}

void init() {
    // Read MCU unique ID (12 bytes)
    uint8_t uid[12];
    readMCUUniqueID(uid);

    // Derive 16-byte key: XOR UID (cycled) with salt
    for (uint8_t i = 0; i < KEY_LEN; i++) {
        s_key[i] = uid[i % 12] ^ SALT[i];
    }

    s_initialized = true;
}

// PKCS7 padding
static uint8_t addPadding(const uint8_t* input, uint16_t len,
                           uint8_t* output, uint16_t out_max) {
    uint8_t pad = BLOCK_SIZE - (len % BLOCK_SIZE);
    uint16_t padded_len = len + pad;
    if (padded_len > out_max) return 0;

    memcpy(output, input, len);
    for (uint8_t i = 0; i < pad; i++) {
        output[len + i] = pad;
    }
    return padded_len;
}

static int16_t removePadding(uint8_t* data, uint16_t len) {
    if (len == 0 || len % BLOCK_SIZE != 0) return -1;

    uint8_t pad = data[len - 1];
    if (pad == 0 || pad > BLOCK_SIZE) return -1;

    // Verify padding bytes
    for (uint8_t i = 0; i < pad; i++) {
        if (data[len - 1 - i] != pad) return -1;
    }

    return len - pad;
}

int encrypt(const uint8_t* plaintext, uint16_t len,
            uint8_t* out_cipher, uint16_t out_max) {
    if (!s_initialized) return -1;

    // Add PKCS7 padding
    uint16_t padded_len = ((len / BLOCK_SIZE) + 1) * BLOCK_SIZE;
    if (padded_len > out_max) return -1;

    uint8_t padded[padded_len];
    uint16_t actual_padded = addPadding(plaintext, len, padded, padded_len);
    if (actual_padded == 0) return -1;

    // Encrypt each block with AES-128-ECB
    mbedtls_aes_context ctx;
    mbedtls_aes_init(&ctx);
    mbedtls_aes_setkey_enc(&ctx, s_key, 128);

    for (uint16_t i = 0; i < actual_padded; i += BLOCK_SIZE) {
        mbedtls_aes_crypt_ecb(&ctx, MBEDTLS_AES_ENCRYPT,
                               padded + i, out_cipher + i);
    }

    mbedtls_aes_free(&ctx);
    return actual_padded;
}

int decrypt(const uint8_t* cipher, uint16_t cipher_len,
            uint8_t* out_plain, uint16_t out_max) {
    if (!s_initialized) return -1;
    if (cipher_len == 0 || cipher_len % BLOCK_SIZE != 0) return -1;
    if (cipher_len > out_max) return -1;

    // Decrypt each block with AES-128-ECB
    mbedtls_aes_context ctx;
    mbedtls_aes_init(&ctx);
    mbedtls_aes_setkey_dec(&ctx, s_key, 128);

    for (uint16_t i = 0; i < cipher_len; i += BLOCK_SIZE) {
        mbedtls_aes_crypt_ecb(&ctx, MBEDTLS_AES_DECRYPT,
                               cipher + i, out_plain + i);
    }

    mbedtls_aes_free(&ctx);

    // Remove padding
    int16_t plain_len = removePadding(out_plain, cipher_len);
    return plain_len;
}

// --- Convenience string functions ---

static char nibbleToHex(uint8_t n) {
    return (n < 10) ? ('0' + n) : ('a' + n - 10);
}

static int8_t hexToNibble(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

String encryptString(const String& plaintext) {
    uint16_t len = plaintext.length();
    uint16_t max_cipher = ((len / BLOCK_SIZE) + 1) * BLOCK_SIZE;
    uint8_t cipher[max_cipher];

    int result = encrypt((const uint8_t*)plaintext.c_str(), len,
                          cipher, max_cipher);
    if (result < 0) return "";

    // Convert to hex string
    String hex;
    hex.reserve(result * 2);
    for (int i = 0; i < result; i++) {
        hex += nibbleToHex(cipher[i] >> 4);
        hex += nibbleToHex(cipher[i] & 0x0F);
    }
    return hex;
}

String decryptString(const String& hex_cipher) {
    uint16_t hex_len = hex_cipher.length();
    if (hex_len == 0 || hex_len % 2 != 0) return "";

    uint16_t cipher_len = hex_len / 2;
    uint8_t cipher[cipher_len];

    // Parse hex
    for (uint16_t i = 0; i < cipher_len; i++) {
        int8_t hi = hexToNibble(hex_cipher[i * 2]);
        int8_t lo = hexToNibble(hex_cipher[i * 2 + 1]);
        if (hi < 0 || lo < 0) return "";
        cipher[i] = (hi << 4) | lo;
    }

    uint8_t plain[cipher_len];
    int result = decrypt(cipher, cipher_len, plain, cipher_len);
    if (result < 0) return "";

    // Null-terminate and return as String
    plain[result] = '\0';
    return String((const char*)plain);
}

} // namespace Crypto
