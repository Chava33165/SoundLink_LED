#include <BLEDevice.h>
#include <BLEUtils.h>
#include <BLEServer.h>

// --- CONFIGURACIÓN ---
#define SERVICE_UUID "12345678-1234-1234-1234-1234567890ab"
#define CHAR_UUID    "87654321-4321-4321-4321-0987654321ab"

const int NUM_LEDS = 10;
const int ledPins[NUM_LEDS] = {0, 1, 2, 3, 5, 6, 7, 8, 9, 10};
volatile int audioLevel = 0;
bool deviceConnected = false;

// --- CALLBACKS DE BLE (VERSIÓN SIMPLIFICADA) ---
class MyCharacteristicCallbacks: public BLECharacteristicCallbacks {
    void onWrite(BLECharacteristic *pCharacteristic) {
        // Obtenemos el valor directamente. La librería lo entrega como un String de Arduino.
        String value = pCharacteristic->getValue();

        if (value.length() > 0) {
            // Convertimos directamente el valor de texto a un número entero.
            audioLevel = value.toInt();

            // Imprimimos en el monitor serie para confirmar que todo va bien.
            Serial.print("Valor Recibido: ");
            Serial.print(value);
            Serial.print(" -> Nivel: ");
            Serial.println(audioLevel);
        }
    }
};

class MyServerCallbacks: public BLEServerCallbacks {
    void onConnect(BLEServer* pServer) {
      deviceConnected = true;
      Serial.println("Dispositivo Conectado");
    }
    void onDisconnect(BLEServer* pServer) {
      deviceConnected = false;
      Serial.println("Dispositivo Desconectado");
      pServer->getAdvertising()->start();
    }
};

// --- FUNCIÓN DE CONFIGURACIÓN ---
void setup() {
  Serial.begin(115200);
  Serial.println("Iniciando SoundLink LED ...");

  for (int i = 0; i < NUM_LEDS; i++) {
    pinMode(ledPins[i], OUTPUT);
    digitalWrite(ledPins[i], LOW);
  }

  BLEDevice::init("ESP32_VUMETER");
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());
  BLEService *pService = pServer->createService(SERVICE_UUID);
  BLECharacteristic *pCharacteristic = pService->createCharacteristic(
                                         CHAR_UUID,
                                         BLECharacteristic::PROPERTY_WRITE
                                       );
  pCharacteristic->setCallbacks(new MyCharacteristicCallbacks());

  pService->start();
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  BLEDevice::startAdvertising();
  
  Serial.println("¡ESP32 listo para recibir datos!");
}

// --- BUCLE PRINCIPAL ---
void loop() {
  updateVumeter(audioLevel);
  delay(20); 
}

// --- FUNCIÓN PARA ACTUALIZAR LOS LEDS ---
void updateVumeter(int level) {
  int ledsToLight = map(level, 0, 100, 0, NUM_LEDS);
  for(int i = 0; i < NUM_LEDS; i++) {
    if(i < ledsToLight) {
      digitalWrite(ledPins[i], HIGH);
    } else {
      digitalWrite(ledPins[i], LOW);
    }
  }
}