import { Text } from 'react-native';
import { fingerprint } from '@/lib/fingerprint';

export default function Index() {
  return <Text>{fingerprint('session')}</Text>;
}
