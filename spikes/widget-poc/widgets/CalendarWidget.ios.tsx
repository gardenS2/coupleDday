import { VStack, Text } from '@expo/ui/swift-ui';
import { containerBackground, foregroundStyle, font, padding } from '@expo/ui/swift-ui/modifiers';
import { createWidget } from 'expo-widgets';
import type { Snapshot } from '../src/snapshot';
const Layout = (props: Snapshot) => {
  'widget';
  return <VStack spacing={0} modifiers={[containerBackground('#211D25', 'widget'), foregroundStyle('#FFFFFF'), padding({all: 0})]}><Text modifiers={[font({size: 12})]}>{props.month}</Text><Text modifiers={[font({size: 10, design: 'monospaced'})]}>일  월  화  수  목  금  토</Text>{props.weeks.map((week, i) => <Text key={i} modifiers={[font({size: 10, design: 'monospaced'})]}>{week}</Text>)}<Text modifiers={[font({size: 8})]}>{props.events.join(' · ')}</Text><Text modifiers={[font({size: 9})]}>가상 데이터 · {props.updated}</Text></VStack>;
};
export default createWidget('CalendarWidget', Layout);
