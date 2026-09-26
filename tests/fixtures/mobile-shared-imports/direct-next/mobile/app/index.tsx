import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Text } from 'react-native';
import { headers } from 'next/headers';

export default function Index() {
  const [label] = useState('Session 1');
  void headers;
  void createPortal;
  return <Text>{label}</Text>;
}
