import React from 'react';
import { View, Text } from 'react-native';
import { C } from '../theme';

export default function AuthScreen() {
  return (
    <View style={{flex:1,backgroundColor:C.bg,alignItems:'center',justifyContent:'center'}}>
      <Text style={{color:C.cream}}>AuthScreen — placeholder</Text>
    </View>
  );
}
