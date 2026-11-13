import { useState } from 'react';
import { Button, Platform, SafeAreaView, Text } from 'react-native';
import DdayWidget from './widgets/DdayWidget';
import CalendarWidget from './widgets/CalendarWidget';
import { snapshot, timeline, seoulDate } from './src/snapshot';
export default function App() {
  const [status, setStatus] = useState('먼저 위젯 갱신을 누른 뒤 홈 화면에 추가하세요.');
  function update(useClock: boolean) {
    try {
      const now = useClock ? new Date() : new Date('2026-10-26T12:00:00+09:00');
      const data = snapshot(seoulDate(now));
      if (Platform.OS === 'ios' && useClock) {
        DdayWidget.updateTimeline(timeline(now)); CalendarWidget.updateTimeline(timeline(now));
      } else { DdayWidget.updateSnapshot(data); CalendarWidget.updateSnapshot(data); }
      setStatus(`갱신 요청 완료: ${data.updated} ${data.dday}. 홈 화면에서 표시를 확인하세요.`);
    } catch (error) { setStatus(`갱신 실패: ${String(error)}`); }
  }
  return <SafeAreaView style={{flex: 1, backgroundColor: '#141116', padding: 24, gap: 20}}>
    <Text style={{color: '#F2A5C1', fontSize: 26}}>커플 위젯 PoC</Text>
    <Text style={{color: 'white'}}>가상 인물·일정만 사용합니다. 서버 연결 없음.</Text>
    <Button title="고정 날짜로 위젯 갱신" onPress={() => update(false)} />
    <Button title="현재 서울 날짜로 갱신 (iOS 7일 예약)" onPress={() => update(true)} />
    <Text style={{color: 'white'}}>{status}</Text>
  </SafeAreaView>;
}
