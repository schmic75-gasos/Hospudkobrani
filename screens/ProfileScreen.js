import React from 'react';
import { View, Text, Button } from 'react-native';
import { C } from '../theme';
import { Avatar } from '../components/Avatar';
import { TabBar } from '../components/TabBar';

export default function ProfileScreen({ navigation }) {
  return (
    <View style={{flex:1,backgroundColor:C.bg}}>
      <View style={{padding:16,alignItems:'center'}}>
        <Avatar size={72} style={{marginBottom:12}} />
        <Text style={{color:C.cream,fontSize:18,fontWeight:'700'}}>Uživatel</Text>
      </View>
      <View style={{flex:1,alignItems:'center',justifyContent:'center'}}>
        <Text style={{color:C.creamDim}}>Profil — placeholder</Text>
      </View>
      <TabBar active="profile" onTab={()=>{}} />
    </View>
  );
}
