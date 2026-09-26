import { Text } from 'react-native';
import { lapLabel } from '@/lib/save-lap';

export default function Index() {
  return <Text>{lapLabel(3)}</Text>;
}
