import React from 'react';
import { TouchableOpacity, Text } from 'react-native';
import { C } from '../theme';

export const FollowButton = ({ following=false, onToggle }) => (
  <TouchableOpacity onPress={onToggle} style={{paddingHorizontal:12,paddingVertical:6,borderRadius:6,backgroundColor: following? C.green : C.amber}}>
    <Text style={{color:C.bg,fontWeight:'700'}}>{following? 'Sleduješ' : 'Sledovat'}</Text>
  </TouchableOpacity>
);

export default FollowButton;
