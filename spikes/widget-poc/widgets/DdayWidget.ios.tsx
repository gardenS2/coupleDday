import { VStack, Text } from '@expo/ui/swift-ui';
import { containerBackground, foregroundStyle, font, padding } from '@expo/ui/swift-ui/modifiers';
import { createWidget } from 'expo-widgets';
import type { Snapshot } from '../src/snapshot';
const Layout = (props: Snapshot) => {
  'widget';
  return <VStack spacing={3} modifiers={[containerBackground('#211D25', 'widget'), foregroundStyle('#FFFFFF'), padding({all: 4})]}><Text>{props.title}</Text><Text modifiers={[font({size: 26, weight: 'bold'}), foregroundStyle('#F2A5C1')]}>{props.dday}</Text><Text modifiers={[font({size: 11})]}>{props.next}</Text><Text modifiers={[font({size: 9})]}>가상 데이터 · {props.updated}</Text></VStack>;
};
export default createWidget('DdayWidget', Layout);
