import Svg, { Circle, Path, Rect } from "react-native-svg";
import type { ColorValue } from "react-native";
export type IconName =
  | "home"
  | "calendar"
  | "drop"
  | "book"
  | "settings"
  | "heart"
  | "trash"
  | "left"
  | "right";
/** Bundled vector paths: no platform glyphs, icon fonts, or network assets. */
export function AppIcon({
  name,
  size = 24,
  color = "#D0BFC9",
  filled = false,
}: {
  name: IconName;
  size?: number;
  color?: ColorValue;
  filled?: boolean;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "home" && (
        <>
          <Path d="M2 11 12 2l10 9M5 9v12h5v-7h4v7h5V9" />
        </>
      )}
      {name === "calendar" && (
        <>
          <Rect x="4" y="5" width="16" height="17" rx="1" />
          <Path d="M8 2v6m8-6v6M4 10h16M8 14h1m6 0h1m-8 4h1m6 0h1" />
        </>
      )}
      {name === "drop" && (
        <>
          <Path
            d="M12 2C9 6 4 11 4 15a8 8 0 0 0 16 0c0-4-5-9-8-13Z"
            fill={filled ? color : "none"}
          />
          <Path d="M8 15c0 2 1.5 4 4 4" stroke={filled ? "#613047" : color} />
        </>
      )}
      {name === "book" && (
        <>
          <Rect x="5" y="3" width="15" height="19" rx="1" />
          <Path d="M8 3v19m4-19v9l2-2 2 2V3" />
        </>
      )}
      {name === "settings" && (
        <>
          <Path d="m10 2-.7 3-2 .9-2.8-.9-2 3.5 2.2 2v3l-2.2 2 2 3.5 2.8-.9 2 .9.7 3h4l.7-3 2-.9 2.8.9 2-3.5-2.2-2v-3l2.2-2-2-3.5-2.8.9-2-.9L14 2Z" />
          <Circle cx="12" cy="12" r="3.5" />
        </>
      )}
      {name === "heart" && (
        <Path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" fill={filled ? color : "none"} />
      )}
      {name === "trash" && (
        <>
          <Path d="M4 6h16M9 3h6M6 6l1 15h10l1-15m-8 4v7m4-7v7" />
        </>
      )}
      {name === "left" && <Path d="m14 6-6 6 6 6" />}
      {name === "right" && <Path d="m10 6 6 6-6 6" />}
    </Svg>
  );
}
export function MoodIcon({
  index,
  size = 28,
}: {
  index: number;
  size?: number;
}) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32">
      <Circle cx="16" cy="16" r="14" fill="#FFD65C" />
      <Circle cx="11" cy="13" r="1.5" fill="#4D342A" />
      <Circle cx="21" cy="13" r="1.5" fill="#4D342A" />
      <Path
        d={
          ["M9 19q7 9 14 0", "M10 21h12", "M10 23q6-7 12 0", "M10 23q6-5 12 0"][
            index
          ]
        }
        fill="none"
        stroke="#4D342A"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {index === 2 && <Path d="M8 15q-6 8 0 8t0-8" fill="#75C9EC" />}
      {index === 3 && (
        <Path
          d="m8 8 6 3m4 0 6-3"
          stroke="#4D342A"
          strokeWidth="2"
          strokeLinecap="round"
        />
      )}
    </Svg>
  );
}
