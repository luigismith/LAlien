/**
 * crypto.h — AES-128-ECB encryption for API key protection on SD card
 * Key derived from MCU unique ID XOR with a fixed salt.
 * Author: Claude Code | Date: 2026-04-13
 */
#pragma once
#include <Arduino.h>

namespace Crypto {

    /// Initialize crypto subsystem (reads MCU unique ID, derives key).
    void init();

    /// Encrypt plaintext. Output buffer must be at least ((len/16)+1)*16 bytes.
    /// Returns number of bytes written to out_cipher, or -1 on error.
    int encrypt(const uint8_t* plaintext, uint16_t len,
                uint8_t* out_cipher, uint16_t out_max);

    /// Decrypt ciphertext. Output buffer must be at least cipher_len bytes.
    /// Returns number of bytes of plaintext, or -1 on error.
    int decrypt(const uint8_t* cipher, uint16_t cipher_len,
                uint8_t* out_plain, uint16_t out_max);

    /// Convenience: encrypt a String, return hex-encoded ciphertext.
    String encryptString(const String& plaintext);

    /// Convenience: decrypt hex-encoded ciphertext, return plaintext String.
    String decryptString(const String& hex_cipher);

} // namespace Crypto
