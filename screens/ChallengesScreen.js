import React from 'react';
import { View, Text } from 'react-native';
import { C } from '../theme';

export default function ChallengesScreen() {
  return (
    <View style={{flex:1,backgroundColor:C.bg,alignItems:'center',justifyContent:'center'}}>
      <Text style={{color:C.cream}}>ChallengesScreen — placeholder</Text>
    </View>
  );
}
