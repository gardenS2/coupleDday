import { Redirect, Tabs } from "expo-router";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppIcon, type IconName } from "../../components/AppIcon";
import { useAuth } from "../../lib/auth";
import { colors, Screen, Body, Button } from "../../components/ui";
export default function Layout() {
  const a = useAuth();
  const insets = useSafeAreaInsets();
  if (a.loading)
    return (
      <Screen>
        <Body>우리의 공간을 열고 있어요…</Body>
      </Screen>
    );
  if (!a.session) return <Redirect href="/login" />;
  if (a.error)
    return (
      <Screen>
        <Body>{a.error}</Body>
        <Button title="연결 다시 확인" onPress={() => void a.refresh()} />
      </Screen>
    );
  if (!a.couple) return <Redirect href="/connect" />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: colors.bg,
          borderTopWidth: 0,
          height: 64 + insets.bottom,
          paddingTop: 8,
          paddingBottom: Math.max(insets.bottom, 6),
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarActiveTintColor: colors.pink,
        tabBarInactiveTintColor: colors.muted,
        sceneStyle: { backgroundColor: colors.bg },
      }}
    >
      {[
        ["index", "홈", "home"],
        ["calendar", "달력", "calendar"],
        ["magic", "마법", "drop"],
        ["records", "기록", "book"],
        ["settings", "설정", "settings"],
      ].map(([name, title, icon]) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color, focused }) => (
              <View
                style={{
                  width: 62,
                  height: 32,
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 22,
                  backgroundColor: focused ? colors.wine : "transparent",
                }}
              >
                <AppIcon
                  name={icon as IconName}
                  size={25}
                  color={color}
                  filled={name === "magic"}
                />
              </View>
            ),
          }}
        />
      ))}
    </Tabs>
  );
}
