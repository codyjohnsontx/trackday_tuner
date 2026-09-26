import { Text } from 'react-native';
import { unitLabel } from '../../lib/units';

export default function Index() {
  return <Text>{unitLabel()}</Text>;
}
