import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Modal,
  StyleSheet,
  PermissionsAndroid,
  Platform,
  Alert,
} from "react-native";
import { BleManager } from "react-native-ble-plx";
import { Buffer } from "buffer"; // Import Buffer
import { Audio } from "expo-av";

// --- CONFIGURACIÓN BLE ---
const SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab";
const CHAR_UUID = "87654321-4321-4321-4321-0987654321ab";

const manager = new BleManager();

export default function App() {
  const [modalVisible, setModalVisible] = useState(false);
  const [connectedDevice, setConnectedDevice] = useState(null);
  const [devices, setDevices] = useState([]);
  const [level, setLevel] = useState(0);
  const [micPermission, setMicPermission] = useState(false);

  const isScanningRef = useRef(false);
  const recordingRef = useRef(null);
  const bleIntervalRef = useRef(null); // Ref to manage BLE sending interval

  // --- EFECTOS DE CICLO DE VIDA ---

  // Pedir permisos de Bluetooth y Micrófono al iniciar
  useEffect(() => {
    const requestPermissions = async () => {
      // 1. Permisos de Bluetooth
      if (Platform.OS === "android") {
        await PermissionsAndroid.requestMultiple([
          PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]);
      }
      // 2. Permiso de Micrófono
      const { status } = await Audio.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert("Permiso denegado", "No se puede acceder al micrófono.");
        setMicPermission(false);
      } else {
        setMicPermission(true);
      }
    };

    requestPermissions();

    return () => {
      stopScanIfNeeded();
      manager.destroy();
    };
  }, []);

  // Manejar el estado del adaptador Bluetooth
  useEffect(() => {
    const sub = manager.onStateChange((state) => {
      console.log("BLE state:", state);
    }, true);
    return () => sub.remove();
  }, []);

  // --- FUNCIONES BLUETOOTH ---

  const stopScanIfNeeded = () => {
    if (isScanningRef.current) {
      try {
        manager.stopDeviceScan();
      } catch (e) {
        console.warn("Error stopping scan:", e);
      }
      isScanningRef.current = false;
    }
  };

  const startScan = async () => {
    stopScanIfNeeded();
    setDevices([]);
    setModalVisible(true);
    isScanningRef.current = true;

    manager.startDeviceScan([SERVICE_UUID], { allowDuplicates: false }, (error, device) => {
      if (error) {
        console.warn("Error al escanear:", error);
        isScanningRef.current = false;
        return;
      }
      if (device) {
        setDevices((prev) => {
          if (prev.find((d) => d.id === device.id)) return prev;
          return [...prev, device];
        });
      }
    });

    setTimeout(stopScanIfNeeded, 8000);
  };

  const connectToDevice = async (device) => {
    try {
      stopScanIfNeeded();
      const connected = await manager.connectToDevice(device.id, { timeout: 10000 });
      await connected.discoverAllServicesAndCharacteristics();
      setConnectedDevice(connected);
      setModalVisible(false);
      console.log("✅ Conectado a:", connected.name || connected.id);
    } catch (err) {
      console.error("Error al conectar:", err);
    }
  };

  const sendLevelToDevice = async (levelValue) => {
      if (!connectedDevice) return;
      try {
        await connectedDevice.writeCharacteristicWithResponseForService(
          SERVICE_UUID,
          CHAR_UUID,
          Buffer.from(levelValue.toString()).toString("base64")
        );
      } catch (err) {
        console.error("❌ Error al enviar:", err);
      }
  };

  // --- FUNCIONES DE MICRÓFONO ---

  const startRealMic = async () => {
    if (!connectedDevice) {
        Alert.alert("Error", "Primero conecta un dispositivo ESP32.");
        return;
    }
    if (!micPermission) {
        Alert.alert("Error", "No hay permiso para usar el micrófono.");
        return;
    }
    if (recordingRef.current) return; // Ya está grabando

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
        undefined,
        100 // Intervalo de actualización en ms
      );
      recordingRef.current = recording;

      recordingRef.current.setOnRecordingStatusUpdate((status) => {
        if (status.metering) {
          const db = status.metering;
          // Mapear dBFS (de -160 a 0) a nuestro rango (0-100)
          // Estos valores (+50 y /50) se pueden ajustar para calibrar la sensibilidad
          const normalized = Math.max(0, (db + 50) / 50); 
          const levelValue = Math.min(100, Math.floor(normalized * 100));
          setLevel(levelValue); // Actualiza la UI
          sendLevelToDevice(levelValue); // Envía el valor por BLE
        }
      });
    } catch (err) {
      console.error('Fallo al iniciar la grabación', err);
    }
  };

  const stopRealMic = async () => {
    if (recordingRef.current) {
      await recordingRef.current.stopAndUnloadAsync();
      recordingRef.current = null;
      setLevel(0);
      sendLevelToDevice(0); // Apaga los LEDs al soltar
    }
  };

  // --- RENDERIZADO DEL COMPONENTE ---

  return (
    <View style={styles.container}>
      <Text style={styles.title}>🎵 SoundLink LED</Text>

      <TouchableOpacity style={styles.button} onPress={startScan}>
        <Text style={styles.buttonText}>🔍 Buscar ESP32</Text>
      </TouchableOpacity>

      <Text style={styles.info}>
        {connectedDevice ? `Conectado a: ${connectedDevice.name || connectedDevice.id}` : "No conectado"}
      </Text>

      <TouchableOpacity
        style={[
          styles.micButton,
          { backgroundColor: level > 10 ? "#ff5252" : "#555" },
        ]}
        onPressIn={startRealMic}
        onPressOut={stopRealMic}
        disabled={!connectedDevice} // Deshabilitar si no hay conexión
      >
        <Text style={styles.micText}>🎙️ Mantén Presionado</Text>
      </TouchableOpacity>

      {/* Vúmetro visual en la app */}
      <View style={styles.vumeterContainer}>
        {[...Array(10)].map((_, i) => (
          <View
            key={i}
            style={[
              styles.vumeterBar,
              {
                backgroundColor:
                  i < Math.floor(level / 10)
                    ? `hsl(${120 - i * 12}, 100%, 50%)`
                    : "#222",
              },
            ]}
          />
        ))}
      </View>

      {/* Modal para seleccionar dispositivo */}
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.modalBackground}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Selecciona tu ESP32</Text>
            <FlatList
              data={devices}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.deviceItem}
                  onPress={() => connectToDevice(item)}
                >
                  <Text style={styles.deviceText}>{item.name || item.id}</Text>
                </TouchableOpacity>
              )}
            />
            <TouchableOpacity
              style={[styles.button, { marginTop: 15, backgroundColor: "#666" }]}
              onPress={() => {
                setModalVisible(false);
                stopScanIfNeeded();
              }}
            >
              <Text style={styles.buttonText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// --- ESTILOS ---
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0c0c0c",
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    color: "#fff",
    fontSize: 26,
    fontWeight: "bold",
    marginBottom: 30,
  },
  info: {
    color: "#ccc",
    marginVertical: 15,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#00bfff",
    paddingHorizontal: 25,
    paddingVertical: 10,
    borderRadius: 15,
  },
  buttonText: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "600",
  },
  micButton: {
    marginTop: 20,
    borderRadius: 100,
    paddingVertical: 40,
    paddingHorizontal: 40,
    borderWidth: 2,
    borderColor: '#444'
  },
  micText: {
    color: "#fff",
    fontSize: 16,
  },
  vumeterContainer: {
    flexDirection: "row",
    height: 120,
    alignItems: "flex-end",
    justifyContent: "center",
    marginTop: 50,
  },
  vumeterBar: {
    width: 20,
    height: '100%',
    marginHorizontal: 4,
    borderRadius: 5,
  },
  modalBackground: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    justifyContent: "center",
    alignItems: "center",
  },
  modalContainer: {
    width: "80%",
    backgroundColor: "#222",
    borderRadius: 15,
    padding: 20,
  },
  modalTitle: {
    color: "#fff",
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 15,
    textAlign: "center",
  },
  deviceItem: {
    padding: 10,
    borderBottomWidth: 1,
    borderColor: "#444",
  },
  deviceText: {
    color: "#fff",
    fontSize: 16,
  },
});