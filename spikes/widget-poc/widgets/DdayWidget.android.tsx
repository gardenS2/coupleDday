import { Column, Text } from '@expo/ui/jetpack-compose';
import { background, paddingAll } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget } from 'expo-widgets';
import type { Snapshot } from '../src/snapshot';
const Layout = (props: Snapshot) => {
  'widget';
  return <Column modifiers={[background('#211D25'), paddingAll(12)]}><Text color="#FFFFFF" >{props.title}</Text><Text color="#FFFFFF" style={{fontSize: 32}}>{props.dday}</Text><Text color="#FFFFFF" >{props.next}</Text><Text color="#FFFFFF" style={{fontSize: 9}}>가상 데이터 · {props.updated}</Text></Column>;
};
export default createWidget('DdayWidget', Layout);
