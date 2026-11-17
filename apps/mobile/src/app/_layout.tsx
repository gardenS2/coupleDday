import { useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AuthProvider } from "../lib/auth";
export default function Layout() {
  const [covered, setCovered] = useState(AppState.currentState !== "active");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setCovered(state !== "active"),
    );
    return () => subscription.remove();
  }, []);
  return (
    <AuthProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: "#141116" },
        }}
      />
      {covered && (
        <View
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: "#141116",
              alignItems: "center",
              justifyContent: "center",
            },
          ]}
        >
          <Text style={{ color: "#F2AAC5", fontSize: 24 }}>♡ 두데이 (2DAY)</Text>
        </View>
      )}
    </AuthProvider>
  );
}
