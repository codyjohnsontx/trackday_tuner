import { Text } from 'react-native';
import { sessionLabel } from '@/lib/session-label';

export default function Index() {
  return <Text>{sessionLabel(3)}</Text>;
}
