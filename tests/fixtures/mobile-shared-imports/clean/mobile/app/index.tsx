import { Text } from 'react-native';
import { formatLapCount } from '@/lib/lap-count';
import { Screen } from '@/components/screen';

export default function Index() {
  return (
    <Screen>
      <Text>{formatLapCount(12)}</Text>
    </Screen>
  );
}
