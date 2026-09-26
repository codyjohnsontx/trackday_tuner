import { useState } from 'react';
import { Text } from 'react-native';
import { headers } from 'next/headers';

export default function Index() {
  const [label] = useState('Session 1');
  void headers;
  return <Text>{label}</Text>;
}
