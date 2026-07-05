import React, { useState } from 'react';
import { Modal, View, Image, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '../theme';

export const PhotoViewer = ({ visible, uri, onClose }) => (
  <Modal visible={visible} transparent animationType="fade">
    <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.9)',alignItems:'center',justifyContent:'center'}}>
      <Image source={{uri}} style={{width:'90%',height:'70%',resizeMode:'contain'}} />
      <TouchableOpacity onPress={onClose} style={{position:'absolute',top:40,right:20}}>
        <Ionicons name="close" size={28} color={C.cream} />
      </TouchableOpacity>
    </View>
  </Modal>
);

export default PhotoViewer;
