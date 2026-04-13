/**
 * tls_certs.cpp — TLS certificate configuration for WiFiSSLClient
 * Loads all root CA certificates so that HTTPS connections to both
 * Anthropic (ISRG Root X1 / Amazon Root CA 1) and OpenAI (DigiCert
 * Global Root G2) succeed.
 * Author: Claude Code | Date: 2026-04-13
 */
#include "tls_certs.h"
#include <WiFiSSLClient.h>

namespace Network {

void configureTLS(WiFiSSLClient& client) {
    // The mbed_giga WiFiSSLClient accepts PEM-encoded root CA certs.
    // We set a combined PEM bundle so the client can verify either
    // Anthropic or OpenAI server certificates.
    //
    // WiFiSSLClient::setCACert() on mbed replaces the CA store each
    // call, so we concatenate all certs into one buffer.

    // Build combined PEM (static, computed once)
    static String combined;
    if (combined.length() == 0) {
        combined.reserve(strlen(ISRG_ROOT_X1) +
                         strlen(AMAZON_ROOT_CA_1) +
                         strlen(DIGICERT_GLOBAL_ROOT_G2) + 4);
        combined += ISRG_ROOT_X1;
        combined += '\n';
        combined += AMAZON_ROOT_CA_1;
        combined += '\n';
        combined += DIGICERT_GLOBAL_ROOT_G2;
    }

    client.setCACert(combined.c_str());
}

} // namespace Network
