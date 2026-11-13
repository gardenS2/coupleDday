import { useState } from "react";
import { View, Text } from "react-native";
import { Redirect, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Chip, colors } from "../components/ui";
import Connect from "../screens/Connect";
import Health from "../screens/Health";
export default function Preview() {
  const [tab, setTab] = useState("health");
  if (!__DEV__) return <Redirect href="/" />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={{ paddingHorizontal: 20, paddingTop: 8, gap: 8 }}>
        <Text style={{ color: colors.mint, fontSize: 12 }}>
          디자인 미리보기 · 가상 데이터 · 서버 저장 없음
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Chip label="‹ 로그인" onPress={() => router.replace("/login")} />
          <Chip
            label="초대"
            selected={tab === "connect"}
            onPress={() => setTab("connect")}
          />
          <Chip
            label="건강 기록"
            selected={tab === "health"}
            onPress={() => setTab("health")}
          />
        </View>
      </View>
      {tab === "health" ? <Health preview /> : <Connect preview />}
    </SafeAreaView>
  );
}
