import React from 'react';
import { Modal, View, Text, TouchableOpacity } from 'react-native';
import { C } from '../theme';

export const TutorialModal = ({ visible, onClose, title, children }) => (
  <Modal visible={visible} transparent animationType="slide">
    <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',padding:20,justifyContent:'center'}}>
      <View style={{backgroundColor:C.bgCard,padding:16,borderRadius:12}}>
        <Text style={{color:C.cream,fontSize:16,fontWeight:'700',marginBottom:8}}>{title}</Text>
        <View style={{marginBottom:12}}>{children}</View>
        <TouchableOpacity onPress={onClose} style={{alignSelf:'flex-end',padding:8}}>
          <Text style={{color:C.amber,fontWeight:'700'}}>Zavřít</Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>
);

export default TutorialModal;
