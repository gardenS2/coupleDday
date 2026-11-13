import { Column, Text } from '@expo/ui/jetpack-compose';
import { background, paddingAll } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget } from 'expo-widgets';
import type { Snapshot } from '../src/snapshot';
const Layout = (props: Snapshot) => {
  'widget';
  return <Column modifiers={[background('#211D25'), paddingAll(12)]}><Text color="#FFFFFF" >{props.month}</Text><Text color="#FFFFFF" style={{fontSize: 11, fontFamily: 'monospace'}}>일  월  화  수  목  금  토</Text>{props.weeks.map((week, i) => <Text color="#FFFFFF" key={i} style={{fontSize: 11, fontFamily: 'monospace'}}>{week}</Text>)}{props.events.map(event => <Text color="#FFFFFF" key={event} style={{fontSize: 11}}>{event}</Text>)}<Text color="#FFFFFF" style={{fontSize: 9}}>가상 데이터 · {props.updated}</Text></Column>;
};
export default createWidget('CalendarWidget', Layout);
