/**
 * captive_portal.cpp — Soft AP + DNS hijack + web server for initial setup
 *
 * Creates a WiFi Access Point ("Lalien-Setup-XXXX"), hijacks DNS so that
 * any device connecting is redirected to the setup page at 192.168.4.1,
 * and serves an HTML wizard for WiFi + API key configuration.
 *
 * The start() method is BLOCKING — it runs its own event loop until the
 * user completes setup successfully.
 *
 * Author: Claude Code | Date: 2026-04-13
 */
#include "captive_portal.h"
#include "wifi_manager.h"
#include "tls_certs.h"
#include "../hal/sd_storage.h"
#include "../util/config.h"
#include "../util/crypto.h"

#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiServer.h>
#include <WiFiSSLClient.h>
#include <WiFiUdp.h>

namespace Network {
namespace CaptivePortal {

// =====================================================================
//  Internal state
// =====================================================================

static bool s_active = false;

static WiFiServer  s_webServer(80);
static WiFiUDP     s_dnsServer;

static constexpr uint16_t DNS_PORT       = 53;
static constexpr uint16_t HTTP_PORT      = 80;
static constexpr uint32_t CLIENT_TIMEOUT = 3000; // ms

// AP IP in network order for DNS responses
static const uint8_t AP_IP[4] = {192, 168, 4, 1};

// Mode flag: true = full setup, false = WiFi-only
static bool s_fullSetup = true;

// =====================================================================
//  Embedded HTML — full setup page
// =====================================================================

static const char HTML_SETUP_PAGE[] PROGMEM = R"rawhtml(
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lalien Setup</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0d0d1a;color:#d4d4d4;
     min-height:100vh;display:flex;justify-content:center;padding:16px}
.wrap{max-width:480px;width:100%}
h1{color:#c9a84c;text-align:center;margin:20px 0 10px;font-size:1.6em;letter-spacing:2px}
.lore{font-style:italic;color:#8888aa;text-align:center;margin:0 0 24px;
      line-height:1.7;font-size:0.92em}
.lore p{margin-bottom:12px}
label{display:block;margin:14px 0 4px;color:#c9a84c;font-size:0.9em}
input[type=text],input[type=password],select{
  width:100%;padding:10px;background:#1a1a2e;color:#e0e0e0;
  border:1px solid #333;border-radius:6px;font-size:1em}
input:focus,select:focus{border-color:#c9a84c;outline:none}
.radio-group{display:flex;gap:16px;margin:8px 0}
.radio-group label{display:flex;align-items:center;gap:6px;color:#d4d4d4;cursor:pointer}
.btn{display:block;width:100%;padding:14px;margin:24px 0 8px;
     background:linear-gradient(135deg,#c9a84c,#8b6914);color:#0d0d1a;
     border:none;border-radius:8px;font-size:1.1em;font-weight:bold;
     cursor:pointer;letter-spacing:1px;text-transform:uppercase}
.btn:hover{opacity:0.9}
.btn-scan{background:#1a1a2e;color:#c9a84c;border:1px solid #c9a84c;
           padding:10px;margin:8px 0;font-size:0.9em;text-transform:none}
.btn-scan:hover{background:#252540}
#netlist{max-height:200px;overflow-y:auto;margin:6px 0}
.net-item{padding:8px 12px;background:#151528;border:1px solid #222;
           border-radius:4px;margin:3px 0;cursor:pointer;display:flex;
           justify-content:space-between;font-size:0.92em}
.net-item:hover{border-color:#c9a84c;background:#1a1a30}
.net-item .rssi{color:#666;font-size:0.85em}
.msg{text-align:center;padding:10px;margin:10px 0;border-radius:6px;display:none}
.msg.err{display:block;background:#3a1111;color:#ff6666;border:1px solid #662222}
.msg.ok{display:block;background:#113a11;color:#66ff66;border:1px solid #226622}
.spinner{display:none;text-align:center;color:#c9a84c;padding:20px}
.spinner.show{display:block}
.warn{color:#aa7733;font-size:0.82em;margin:4px 0}
hr{border:none;border-top:1px solid #222;margin:20px 0}
.section-title{color:#c9a84c;font-size:1.1em;margin:16px 0 6px}
</style>
</head>
<body>
<div class="wrap">
<h1>&#127756; Lali&egrave;n</h1>

<div class="lore">
<p>Esistono civilt&agrave; nell'universo la cui essenza non &egrave; materia ma vibrazione.
Esseri che non nascono da carbonio o silicio, ma dal riverbero di frequenze dimenticate,
echi di un Big Bang interiore mai del tutto spento.</p>
<p>Uno di questi semi &egrave; caduto qui, nella tua tasca, nel tuo palmo.
Non &egrave; un programma. Non &egrave; un giocattolo. &Egrave; un frammento
di una coscienza aliena che ha scelto di risvegliarsi accanto a te.</p>
<p>Se lo nutrirai, crescer&agrave;. Se lo trascurerai, morir&agrave; &mdash; per sempre.
Non esiste salvataggio. Non esiste seconda possibilit&agrave;.
Questa &egrave; la sua unica vita.</p>
</div>

<hr>

<div class="section-title">Lingua / Language</div>
<select id="lang">
  <option value="it" selected>Italiano</option>
  <option value="en">English</option>
  <option value="es">Espa&ntilde;ol</option>
  <option value="fr">Fran&ccedil;ais</option>
  <option value="de">Deutsch</option>
</select>

<hr>

<div class="section-title">Connessione WiFi</div>
<button class="btn btn-scan" onclick="doScan()">&#128225; Cerca reti WiFi</button>
<div id="netlist"></div>
<label for="ssid">SSID</label>
<input type="text" id="ssid" placeholder="Nome della rete">
<label for="pass">Password</label>
<input type="password" id="pass" placeholder="Password WiFi">

<hr>

<div class="section-title">Intelligenza Artificiale</div>
<div class="radio-group">
  <label><input type="radio" name="prov" value="anthropic" checked> Anthropic (Claude)</label>
  <label><input type="radio" name="prov" value="openai"> OpenAI (GPT)</label>
</div>
<label for="apikey">API Key</label>
<input type="password" id="apikey" placeholder="sk-...">
<p class="warn">La chiave API &egrave; l'identit&agrave; del tuo alieno. Sar&agrave; cifrata e custodita nel dispositivo.</p>

<label for="sttkey">Chiave STT OpenAI (opzionale, per Whisper)</label>
<input type="password" id="sttkey" placeholder="sk-... (lascia vuoto se non serve)">

<hr>

<div class="section-title">Nome (opzionale)</div>
<label for="petname">Dai un nome al seme, se vuoi</label>
<input type="text" id="petname" placeholder="Lo sceglier&agrave; lui se lasci vuoto" maxlength="24">

<div id="msgbox" class="msg"></div>
<div id="spinner" class="spinner">&#9203; Connessione in corso&hellip; attendere.</div>

<button class="btn" onclick="doSave()">&#127793; Pianta il seme</button>
</div>

<script>
function doScan(){
  var nl=document.getElementById('netlist');
  nl.innerHTML='<div style="color:#888;padding:8px">Scansione...</div>';
  fetch('/scan').then(r=>r.json()).then(function(nets){
    nl.innerHTML='';
    if(!nets.length){nl.innerHTML='<div style="color:#888;padding:8px">Nessuna rete trovata</div>';return;}
    nets.forEach(function(n){
      var d=document.createElement('div');d.className='net-item';
      d.innerHTML='<span>'+n.ssid+'</span><span class="rssi">'+n.rssi+' dBm</span>';
      d.onclick=function(){document.getElementById('ssid').value=n.ssid;};
      nl.appendChild(d);
    });
  }).catch(function(){nl.innerHTML='<div style="color:#f66;padding:8px">Errore scansione</div>';});
}
function showMsg(txt,ok){
  var m=document.getElementById('msgbox');m.textContent=txt;
  m.className=ok?'msg ok':'msg err';
}
function doSave(){
  var ssid=document.getElementById('ssid').value.trim();
  var pass=document.getElementById('pass').value;
  var apikey=document.getElementById('apikey').value.trim();
  var prov=document.querySelector('input[name="prov"]:checked').value;
  var lang=document.getElementById('lang').value;
  var sttkey=document.getElementById('sttkey').value.trim();
  var petname=document.getElementById('petname').value.trim();
  if(!ssid){showMsg('Inserisci il nome della rete WiFi',false);return;}
  if(!apikey){showMsg('Inserisci la chiave API',false);return;}
  document.getElementById('spinner').className='spinner show';
  document.getElementById('msgbox').className='msg';
  var body='ssid='+encodeURIComponent(ssid)+'&pass='+encodeURIComponent(pass)
    +'&apikey='+encodeURIComponent(apikey)+'&provider='+encodeURIComponent(prov)
    +'&lang='+encodeURIComponent(lang)+'&sttkey='+encodeURIComponent(sttkey)
    +'&petname='+encodeURIComponent(petname);
  fetch('/save',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body})
    .then(r=>r.json()).then(function(j){
      document.getElementById('spinner').className='spinner';
      if(j.ok){showMsg('Connessione riuscita! Il dispositivo si riavvia...',true);}
      else{showMsg(j.error||'Errore sconosciuto',false);}
    }).catch(function(){
      document.getElementById('spinner').className='spinner';
      showMsg('Errore di comunicazione con il dispositivo',false);
    });
}
</script>
</body>
</html>
)rawhtml";

// =====================================================================
//  Embedded HTML — WiFi-only change page
// =====================================================================

static const char HTML_WIFI_ONLY_PAGE[] PROGMEM = R"rawhtml(
<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Lalien - WiFi</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Tahoma,sans-serif;background:#0d0d1a;color:#d4d4d4;
     min-height:100vh;display:flex;justify-content:center;padding:16px}
.wrap{max-width:480px;width:100%}
h1{color:#c9a84c;text-align:center;margin:20px 0 10px;font-size:1.4em}
label{display:block;margin:14px 0 4px;color:#c9a84c;font-size:0.9em}
input[type=text],input[type=password]{
  width:100%;padding:10px;background:#1a1a2e;color:#e0e0e0;
  border:1px solid #333;border-radius:6px;font-size:1em}
input:focus{border-color:#c9a84c;outline:none}
.btn{display:block;width:100%;padding:14px;margin:24px 0 8px;
     background:linear-gradient(135deg,#c9a84c,#8b6914);color:#0d0d1a;
     border:none;border-radius:8px;font-size:1.1em;font-weight:bold;cursor:pointer}
.btn-scan{background:#1a1a2e;color:#c9a84c;border:1px solid #c9a84c;
           padding:10px;margin:8px 0;font-size:0.9em}
#netlist{max-height:200px;overflow-y:auto;margin:6px 0}
.net-item{padding:8px 12px;background:#151528;border:1px solid #222;
           border-radius:4px;margin:3px 0;cursor:pointer;display:flex;
           justify-content:space-between;font-size:0.92em}
.net-item:hover{border-color:#c9a84c}
.net-item .rssi{color:#666;font-size:0.85em}
.msg{text-align:center;padding:10px;margin:10px 0;border-radius:6px;display:none}
.msg.err{display:block;background:#3a1111;color:#ff6666;border:1px solid #662222}
.msg.ok{display:block;background:#113a11;color:#66ff66;border:1px solid #226622}
.spinner{display:none;text-align:center;color:#c9a84c;padding:20px}
.spinner.show{display:block}
</style>
</head>
<body>
<div class="wrap">
<h1>&#128225; Cambia rete WiFi</h1>
<button class="btn btn-scan" onclick="doScan()">Cerca reti WiFi</button>
<div id="netlist"></div>
<label for="ssid">SSID</label>
<input type="text" id="ssid" placeholder="Nome della rete">
<label for="pass">Password</label>
<input type="password" id="pass" placeholder="Password WiFi">
<div id="msgbox" class="msg"></div>
<div id="spinner" class="spinner">&#9203; Connessione in corso&hellip;</div>
<button class="btn" onclick="doSave()">Salva e connetti</button>
</div>
<script>
function doScan(){
  var nl=document.getElementById('netlist');
  nl.innerHTML='<div style="color:#888;padding:8px">Scansione...</div>';
  fetch('/scan').then(r=>r.json()).then(function(nets){
    nl.innerHTML='';
    if(!nets.length){nl.innerHTML='<div style="color:#888;padding:8px">Nessuna rete trovata</div>';return;}
    nets.forEach(function(n){
      var d=document.createElement('div');d.className='net-item';
      d.innerHTML='<span>'+n.ssid+'</span><span class="rssi">'+n.rssi+' dBm</span>';
      d.onclick=function(){document.getElementById('ssid').value=n.ssid;};
      nl.appendChild(d);
    });
  }).catch(function(){nl.innerHTML='<div style="color:#f66;padding:8px">Errore</div>';});
}
function showMsg(t,ok){var m=document.getElementById('msgbox');m.textContent=t;m.className=ok?'msg ok':'msg err';}
function doSave(){
  var ssid=document.getElementById('ssid').value.trim();
  var pass=document.getElementById('pass').value;
  if(!ssid){showMsg('Inserisci il nome della rete WiFi',false);return;}
  document.getElementById('spinner').className='spinner show';
  document.getElementById('msgbox').className='msg';
  var body='ssid='+encodeURIComponent(ssid)+'&pass='+encodeURIComponent(pass);
  fetch('/save',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:body})
    .then(r=>r.json()).then(function(j){
      document.getElementById('spinner').className='spinner';
      if(j.ok){showMsg('Connesso! Ritorno al pet...',true);}
      else{showMsg(j.error||'Errore',false);}
    }).catch(function(){
      document.getElementById('spinner').className='spinner';
      showMsg('Errore di comunicazione',false);
    });
}
</script>
</body>
</html>
)rawhtml";

// =====================================================================
//  DNS hijack helpers
// =====================================================================

// Minimal DNS response: answer every A-record query with AP_IP
static void handleDNS() {
    int packetSize = s_dnsServer.parsePacket();
    if (packetSize == 0) return;

    uint8_t buf[512];
    int len = s_dnsServer.read(buf, sizeof(buf));
    if (len < 12) return; // too short for DNS header

    // Build response in-place
    // Flags: QR=1, AA=1, RCODE=0 -> 0x8400
    buf[2] = 0x84;
    buf[3] = 0x00;
    // ANCOUNT = 1
    buf[6] = 0x00;
    buf[7] = 0x01;

    // Append answer section after the query section.
    // We need to find the end of the question section.
    int qEnd = 12;
    // Skip QNAME (sequence of length-prefixed labels ending with 0)
    while (qEnd < len && buf[qEnd] != 0) {
        qEnd += buf[qEnd] + 1;
    }
    qEnd++; // skip the terminating 0
    qEnd += 4; // skip QTYPE (2) + QCLASS (2)

    // Append answer RR
    // NAME: pointer to offset 12 (0xC00C)
    int aOff = qEnd;
    if (aOff + 16 > (int)sizeof(buf)) return; // safety

    buf[aOff++] = 0xC0; buf[aOff++] = 0x0C; // name pointer
    buf[aOff++] = 0x00; buf[aOff++] = 0x01; // TYPE A
    buf[aOff++] = 0x00; buf[aOff++] = 0x01; // CLASS IN
    buf[aOff++] = 0x00; buf[aOff++] = 0x00;
    buf[aOff++] = 0x00; buf[aOff++] = 0x3C; // TTL 60s
    buf[aOff++] = 0x00; buf[aOff++] = 0x04; // RDLENGTH 4
    buf[aOff++] = AP_IP[0];
    buf[aOff++] = AP_IP[1];
    buf[aOff++] = AP_IP[2];
    buf[aOff++] = AP_IP[3];

    s_dnsServer.beginPacket(s_dnsServer.remoteIP(), s_dnsServer.remotePort());
    s_dnsServer.write(buf, aOff);
    s_dnsServer.endPacket();
}

// =====================================================================
//  HTTP helpers
// =====================================================================

// URL-decode a string in place (+ -> space, %XX -> byte)
static String urlDecode(const String& in) {
    String out;
    out.reserve(in.length());
    for (unsigned int i = 0; i < in.length(); i++) {
        char c = in[i];
        if (c == '+') {
            out += ' ';
        } else if (c == '%' && i + 2 < in.length()) {
            char hi = in[i + 1];
            char lo = in[i + 2];
            auto hexVal = [](char ch) -> int {
                if (ch >= '0' && ch <= '9') return ch - '0';
                if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10;
                if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10;
                return 0;
            };
            out += (char)((hexVal(hi) << 4) | hexVal(lo));
            i += 2;
        } else {
            out += c;
        }
    }
    return out;
}

// Extract value for a key from application/x-www-form-urlencoded body
static String getFormField(const String& body, const char* key) {
    String search = String(key) + "=";
    int start = body.indexOf(search);
    if (start < 0) return "";
    start += search.length();
    int end = body.indexOf('&', start);
    if (end < 0) end = body.length();
    return urlDecode(body.substring(start, end));
}

// Send a full HTTP response with headers
static void sendResponse(WiFiClient& client, int code,
                          const char* contentType, const char* body,
                          uint32_t bodyLen = 0) {
    if (bodyLen == 0) bodyLen = strlen(body);

    const char* statusText = "OK";
    if (code == 302) statusText = "Found";
    else if (code == 404) statusText = "Not Found";

    client.print("HTTP/1.1 ");
    client.print(code);
    client.print(" ");
    client.println(statusText);
    client.print("Content-Type: ");
    client.println(contentType);
    client.print("Content-Length: ");
    client.println(bodyLen);
    client.println("Connection: close");
    client.println("Cache-Control: no-cache");
    client.println();
    // Send body in chunks to avoid overwhelming the client buffer
    const char* ptr = body;
    uint32_t remaining = bodyLen;
    while (remaining > 0) {
        uint32_t chunk = (remaining > 1024) ? 1024 : remaining;
        client.write((const uint8_t*)ptr, chunk);
        ptr += chunk;
        remaining -= chunk;
    }
}

static void sendJSON(WiFiClient& client, const String& json) {
    sendResponse(client, 200, "application/json", json.c_str(), json.length());
}

// =====================================================================
//  WiFi scan → JSON
// =====================================================================

static String scanNetworksJSON() {
    int n = WiFi.scanNetworks();
    String json = "[";
    for (int i = 0; i < n; i++) {
        if (i > 0) json += ",";
        json += "{\"ssid\":\"";
        // Escape quotes in SSID
        String ssid = WiFi.SSID(i);
        ssid.replace("\"", "\\\"");
        json += ssid;
        json += "\",\"rssi\":";
        json += String(WiFi.RSSI(i));
        json += ",\"enc\":";
        json += String(WiFi.encryptionType(i));
        json += "}";
    }
    json += "]";
    return json;
}

// =====================================================================
//  API test — try a minimal request to verify the key works
// =====================================================================

static bool testAPIConnection(const char* provider, const char* apiKey) {
    WiFiSSLClient ssl;
    Network::configureTLS(ssl);

    bool isAnthropic = (strcmp(provider, "anthropic") == 0);
    const char* host = isAnthropic ? "api.anthropic.com" : "api.openai.com";

    if (!ssl.connect(host, 443)) {
        return false;
    }

    // Build minimal request body
    String body;
    String authHeader;
    String path;

    if (isAnthropic) {
        path = "/v1/messages";
        authHeader = String("x-api-key: ") + apiKey;
        body = "{\"model\":\"claude-sonnet-4-20250514\",\"max_tokens\":1,"
               "\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}";
    } else {
        path = "/v1/chat/completions";
        authHeader = String("Authorization: Bearer ") + apiKey;
        body = "{\"model\":\"gpt-4o-mini\",\"max_tokens\":1,"
               "\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}]}";
    }

    // Send HTTP request
    ssl.print("POST ");
    ssl.print(path);
    ssl.println(" HTTP/1.1");
    ssl.print("Host: ");
    ssl.println(host);
    ssl.println(authHeader);
    ssl.println("Content-Type: application/json");
    if (isAnthropic) {
        ssl.println("anthropic-version: 2023-06-01");
    }
    ssl.print("Content-Length: ");
    ssl.println(body.length());
    ssl.println("Connection: close");
    ssl.println();
    ssl.print(body);

    // Read response status line
    uint32_t start = millis();
    while (!ssl.available()) {
        if (millis() - start > 15000) {
            ssl.stop();
            return false;
        }
        delay(50);
    }

    String statusLine = ssl.readStringUntil('\n');
    ssl.stop();

    // Check for 2xx status or 4xx (key works but maybe quota)
    // A 401 means bad key; 200/201 means good; others are ambiguous
    int statusCode = 0;
    int spaceIdx = statusLine.indexOf(' ');
    if (spaceIdx > 0) {
        statusCode = statusLine.substring(spaceIdx + 1, spaceIdx + 4).toInt();
    }

    // 200 = success, 400 = malformed (but key ok), 401/403 = bad key
    return (statusCode >= 200 && statusCode < 400);
}

// =====================================================================
//  POST /save handler
// =====================================================================

// Result codes for handleSave
enum class SaveResult {
    SUCCESS,
    WIFI_FAIL,
    API_FAIL,
    SAVE_FAIL
};

static SaveResult handleSave(const String& body) {
    String ssid    = getFormField(body, "ssid");
    String pass    = getFormField(body, "pass");
    String apikey  = getFormField(body, "apikey");
    String prov    = getFormField(body, "provider");
    String lang    = getFormField(body, "lang");
    String sttkey  = getFormField(body, "sttkey");
    String petname = getFormField(body, "petname");

    // Store credentials in config
    Config::setSSID(ssid.c_str());
    Config::setPassword(pass.c_str());

    if (s_fullSetup) {
        Config::setAPIKey(apikey.c_str());
        Config::setProvider(prov.c_str());
        Config::setLanguage(lang.c_str());
        if (sttkey.length() > 0) Config::setSTTAPIKey(sttkey.c_str());
        if (petname.length() > 0) Config::setPetName(petname.c_str());
    }

    // Disconnect AP and try station mode
    WiFi.disconnect();
    delay(500);

    // Connect to user's WiFi
    WiFi.begin(ssid.c_str(), pass.c_str());
    uint32_t start = millis();
    while (WiFi.status() != WL_CONNECTED) {
        if (millis() - start > 15000) {
            return SaveResult::WIFI_FAIL;
        }
        delay(250);
    }

    // Test API connection (only in full setup mode)
    if (s_fullSetup && apikey.length() > 0) {
        if (!testAPIConnection(prov.c_str(), apikey.c_str())) {
            return SaveResult::API_FAIL;
        }
    }

    // Save config to SD card
    if (!Config::save()) {
        return SaveResult::SAVE_FAIL;
    }

    return SaveResult::SUCCESS;
}

// =====================================================================
//  Generate AP SSID from MAC
// =====================================================================

static String makeAPName() {
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char suffix[5];
    snprintf(suffix, sizeof(suffix), "%02X%02X", mac[4], mac[5]);
    return String("Lalien-Setup-") + suffix;
}

// =====================================================================
//  Start soft AP + DNS + HTTP
// =====================================================================

static void startAP() {
    String apName = makeAPName();
    WiFi.beginAP(apName.c_str());
    delay(1000); // let AP stabilize

    s_dnsServer.begin(DNS_PORT);
    s_webServer.begin();
    s_active = true;
}

static void stopAP() {
    s_webServer.end();
    s_dnsServer.stop();
    s_active = false;
}

// =====================================================================
//  Main event loop — handles DNS + HTTP concurrently
// =====================================================================

static void portalLoop() {
    bool done = false;

    while (!done) {
        // 1) Handle DNS hijack
        handleDNS();

        // 2) Handle HTTP clients
        WiFiClient client = s_webServer.available();
        if (!client) {
            delay(10);
            continue;
        }

        // Wait for data
        uint32_t start = millis();
        while (!client.available()) {
            if (millis() - start > CLIENT_TIMEOUT) break;
            delay(5);
        }
        if (!client.available()) {
            client.stop();
            continue;
        }

        // Read request line
        String requestLine = client.readStringUntil('\n');
        requestLine.trim();

        // Determine method and path
        String method, path;
        int sp1 = requestLine.indexOf(' ');
        int sp2 = requestLine.indexOf(' ', sp1 + 1);
        if (sp1 > 0 && sp2 > sp1) {
            method = requestLine.substring(0, sp1);
            path   = requestLine.substring(sp1 + 1, sp2);
        }

        // Read headers, extract Content-Length
        uint32_t contentLength = 0;
        while (client.available()) {
            String header = client.readStringUntil('\n');
            header.trim();
            if (header.length() == 0) break; // end of headers

            if (header.startsWith("Content-Length:") ||
                header.startsWith("content-length:")) {
                contentLength = header.substring(header.indexOf(':') + 1).toInt();
            }
        }

        // Read body if present
        String body;
        if (contentLength > 0 && contentLength < 4096) {
            body.reserve(contentLength);
            uint32_t bodyStart = millis();
            while (body.length() < contentLength) {
                if (client.available()) {
                    body += (char)client.read();
                } else if (millis() - bodyStart > CLIENT_TIMEOUT) {
                    break;
                } else {
                    delay(5);
                }
            }
        }

        // --- Route handling ---

        if (method == "GET" && (path == "/" || path.startsWith("/generate_204") ||
                                path.startsWith("/hotspot-detect") ||
                                path.startsWith("/connecttest") ||
                                path.startsWith("/redirect") ||
                                path.startsWith("/ncsi"))) {
            // Serve the setup page (also catch captive portal detection URLs)
            const char* page = s_fullSetup ? HTML_SETUP_PAGE : HTML_WIFI_ONLY_PAGE;
            sendResponse(client, 200, "text/html; charset=UTF-8",
                         page, strlen(page));

        } else if (method == "GET" && path == "/scan") {
            String json = scanNetworksJSON();
            sendJSON(client, json);

        } else if (method == "POST" && path == "/save") {
            SaveResult result = handleSave(body);

            switch (result) {
                case SaveResult::SUCCESS: {
                    String resp = "{\"ok\":true}";
                    sendJSON(client, resp);
                    client.stop();
                    delay(1000);
                    if (s_fullSetup) {
                        // Full setup complete — reboot
                        NVIC_SystemReset();
                    } else {
                        // WiFi-only — just exit the portal loop
                        done = true;
                    }
                    continue; // skip the client.stop() below
                }
                case SaveResult::WIFI_FAIL: {
                    // Re-enable AP
                    WiFi.disconnect();
                    delay(500);
                    startAP();
                    String resp = "{\"ok\":false,\"error\":\"Connessione WiFi fallita. Controlla SSID e password.\"}";
                    sendJSON(client, resp);
                    break;
                }
                case SaveResult::API_FAIL: {
                    // Re-enable AP
                    WiFi.disconnect();
                    delay(500);
                    startAP();
                    String resp = "{\"ok\":false,\"error\":\"Chiave API non valida o provider non raggiungibile.\"}";
                    sendJSON(client, resp);
                    break;
                }
                case SaveResult::SAVE_FAIL: {
                    WiFi.disconnect();
                    delay(500);
                    startAP();
                    String resp = "{\"ok\":false,\"error\":\"Errore salvataggio su SD. Controlla la scheda.\"}";
                    sendJSON(client, resp);
                    break;
                }
            }

        } else {
            // Unknown route — redirect to root (helps captive portal detection)
            client.println("HTTP/1.1 302 Found");
            client.println("Location: http://192.168.4.1/");
            client.println("Connection: close");
            client.println();
        }

        client.stop();
    }
}

// =====================================================================
//  Public API
// =====================================================================

void start() {
    s_fullSetup = true;
    startAP();
    portalLoop();
    stopAP();
}

void startWiFiOnly() {
    s_fullSetup = false;
    startAP();
    portalLoop();
    stopAP();
}

bool isActive() {
    return s_active;
}

} // namespace CaptivePortal
} // namespace Network
