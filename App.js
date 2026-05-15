/**
 * Hospůdkobraní – App.js v1.4.7 (beta, no-production version)
 * HOSPŮDKOBRANÍ JE DÍLEM MICHALA SCHNEIDERA. PROSÍM, NEKOPÍRUJTE ANI NEVYUŽÍVEJTE KÓD NEBO OBSAH APLIKACE BEZ JEHO SOUHLASU.
 * Nové funkce: trasování, transport módy, heatmap kalendář, prvochlasty, změna hesla, sdílení aj.
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  Alert, Modal, Image, ActivityIndicator, FlatList, Dimensions,
  Platform, StatusBar, Animated, KeyboardAvoidingView, RefreshControl,
  Linking, Share,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import NetInfo from '@react-native-community/netinfo';
import * as TaskManager from 'expo-task-manager';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';


const { width: SW, height: SH } = Dimensions.get('window');
const API = 'https://hospudkobrani-8888.rostiapp.cz/api';

const MAPBOX_TOKEN = 'pk.eyJ1IjoidGhpc2lrIiwiYSI6ImNtbndzZ2t2dzFmemcycXF1OXpidzdsdjEifQ.7BWpQMyfYfi9sDoGZt7lFQ';
const MAPBOX_STYLE_URL = 'mapbox://styles/thisik/cmnwu4fxv003p01s731x1b5wx';
const MAPBOX_STYLE_OPTIONS = [
  { id: 'hospudkobrani', label: 'Hospůdkobranická mapa', url: MAPBOX_STYLE_URL },
  { id: 'basic', label: 'Základní mapa', url: 'mapbox://styles/thisik/cmoyl7ob5002h01sb8uh4fumf' },
];
const INITIAL_MAP_CENTER = [13.3736, 49.7384];
const PUBS_SOURCE_ID = 'pubs-source';
const SELECTED_PUB_SOURCE_ID = 'selected-pub-source';
const TRANSPORT_SOURCE_ID = 'transport-source';
const PARKING_SOURCE_ID = 'parking-source';

const MAPBOX_SDK = (() => {
  try {
    const mod = require('@rnmapbox/maps');
    mod.default.setAccessToken(MAPBOX_TOKEN);
    mod.default.setTelemetryEnabled(false);
    return mod;
  } catch (error) {
    console.warn('Mapbox native SDK neni dostupne.', error);
    return null;
  }
})();

const MapboxNative = MAPBOX_SDK?.default;
const MapboxMapView = MAPBOX_SDK?.MapView;
const MapboxCamera = MAPBOX_SDK?.Camera;
const MapboxShapeSource = MAPBOX_SDK?.ShapeSource;
const MapboxCircleLayer = MAPBOX_SDK?.CircleLayer;
const MapboxSymbolLayer = MAPBOX_SDK?.SymbolLayer;
const MapboxLocationPuck = MAPBOX_SDK?.LocationPuck;
const MapboxLineLayer = MAPBOX_SDK?.LineLayer;
const MapboxImages = MAPBOX_SDK?.Images;

// ─── THEME ────────────────────────────────────────────────────────────────────
const C = {
  bg: '#0F0A00', bgCard: '#1A1200', bgCardAlt: '#221900',
  amber: '#F5A623', amberDark: '#C07D10', gold: '#D4A017',
  cream: '#F5ECD7', creamDim: '#A89070',
  red: '#C0392B', green: '#27AE60', blue: '#2980B9',
  border: '#3D2800', white: '#FFFFFF', tabBar: '#130D00', star: '#FFD700',
  purple: '#8E44AD', teal: '#16A085',
};

const mapLayerStyles = {
  clusterCircles: {
    circlePitchAlignment: 'map',
    circleColor: ['step', ['get', 'point_count'], C.amberDark, 15, C.amber, 40, '#FFD166'],
    circleRadius: ['step', ['get', 'point_count'], 20, 15, 26, 40, 32],
    circleStrokeWidth: 2,
    circleStrokeColor: C.bgCard,
    circleOpacity: 0.95,
  },
  clusterLabels: {
    textField: ['get', 'point_count_abbreviated'],
    textSize: 12,
    textColor: C.bg,
    textAllowOverlap: true,
    textIgnorePlacement: true,
  },
  pubs: {
    circlePitchAlignment: 'map',
    circleColor: ['case', ['==', ['get', 'visited'], 1], C.green, C.amber],
    circleRadius: ['interpolate', ['linear'], ['zoom'], 8, 6, 12, 8.5, 16, 11],
    circleStrokeWidth: 2,
    circleStrokeColor: C.bgCard,
    circleOpacity: 0.97,
  },
  selectedPub: {
    circlePitchAlignment: 'map',
    circleColor: 'rgba(255,255,255,0.14)',
    circleStrokeColor: C.white,
    circleStrokeWidth: 3,
    circleRadius: ['interpolate', ['linear'], ['zoom'], 8, 12, 12, 16, 16, 20],
  },
  transport: {
    circlePitchAlignment: 'map',
    circleColor: [
      'match',
      ['get', 'stop_type'],
      'train', C.purple,
      'station', C.purple,
      'halt', C.purple,
      'platform', C.blue,
      'stop_position', C.blue,
      C.blue
    ],
    circleRadius: ['interpolate', ['linear'], ['zoom'], 8, 4.5, 12, 6.5, 16, 9],
    circleStrokeWidth: 1.5,
    circleStrokeColor: C.bgCard,
    circleOpacity: 0.95,
  },
  parking: {
    circlePitchAlignment: 'map',
    circleColor: C.teal,
    circleRadius: ['interpolate', ['linear'], ['zoom'], 8, 4.5, 12, 6.5, 16, 9],
    circleStrokeWidth: 1.5,
    circleStrokeColor: C.bgCard,
    circleOpacity: 0.95,
  },
  poiLabels: {
    textField: ['coalesce', ['get', 'name'], ''],
    textSize: 11,
    textColor: C.cream,
    textHaloColor: C.bg,
    textHaloWidth: 1.2,
    textAllowOverlap: false,
    textAnchor: 'top',
    textOffset: [0, 1.1],
    textOptional: true,
  },
};


// ─── API ──────────────────────────────────────────────────────────────────────
const getToken = () => AsyncStorage.getItem('auth_token');
const apiFetch = async (ep, opts = {}) => {
  const token = await getToken();
  const res = await fetch(`${API}${ep}`, {
    ...opts,
    headers: { 'Content-Type':'application/json', ...(token ? { Authorization:`Bearer ${token}` } : {}), ...opts.headers },
  });
  if (!res.ok) { const e = await res.json().catch(()=>({message:'Chyba serveru'})); throw new Error(e.message||'Chyba serveru'); }
  return res.json();
};

// ─── FOLLOW HELPERS ──────────────────────────────────────────────────────────
const followUser = async (userId) => {
  const res = await apiFetch(`/users/${userId}/follow`, { method: 'POST' });
  return res.is_following;
};

const unfollowUser = async (userId) => {
  const res = await apiFetch(`/users/${userId}/unfollow`, { method: 'POST' });
  return res.is_following;
};

const getFollowersList = async (userId, limit=20) => apiFetch(`/users/${userId}/followers`);
const getFollowingList = async (userId, limit=20) => apiFetch(`/users/${userId}/following`);


// ─── CACHE ────────────────────────────────────────────────────────────────────
const TTL = 5*60*1000, mem = {};


const cached = async (k, fn, ttl=TTL) => {
  const now = Date.now();
  if (mem[k] && now-mem[k].ts < ttl) return mem[k].data;
  try { const s = await AsyncStorage.getItem(`c_${k}`); if (s) { const p=JSON.parse(s); if (now-p.ts<ttl){mem[k]=p;return p.data;} } } catch {}
  const data = await fn(); const e={data,ts:now}; mem[k]=e;
  AsyncStorage.setItem(`c_${k}`,JSON.stringify(e)).catch(()=>{});
  return data;
};
const bust = k => { delete mem[k]; AsyncStorage.removeItem(`c_${k}`).catch(()=>{}); };

// ─── OFFLINE OBLASTI (státy) ──────────────────────────────────────────────────
const COUNTRIES = [
  { code:'CZ', name:'Česká republika', flag:'🇨🇿', bounds: { minLat:48.5, maxLat:51.1, minLng:12.0, maxLng:18.9 } },
  { code:'SK', name:'Slovensko',        flag:'🇸🇰', bounds: { minLat:47.7, maxLat:49.6, minLng:16.8, maxLng:22.6 } },
  { code:'AT', name:'Rakousko',         flag:'🇦🇹', bounds: { minLat:46.3, maxLat:49.0, minLng:9.5, maxLng:17.2 } },
  { code:'DE', name:'Německo',          flag:'🇩🇪', bounds: { minLat:47.2, maxLat:55.1, minLng:5.9, maxLng:15.0 } },
  { code:'PL', name:'Polsko',           flag:'🇵🇱', bounds: { minLat:49.0, maxLat:54.9, minLng:14.1, maxLng:24.2 } },
  { code:'HU', name:'Maďarsko',         flag:'🇭🇺', bounds: { minLat:45.7, maxLat:48.6, minLng:16.1, maxLng:22.9 } },
];
const getOfflinePubs   = async () => { const r=await AsyncStorage.getItem('offline_pubs');   return r?JSON.parse(r):[]; };
const getOfflineAreas  = async () => { const r=await AsyncStorage.getItem('offline_areas');  return r?JSON.parse(r):[]; };
const saveOfflinePubs  = async d  => AsyncStorage.setItem('offline_pubs',JSON.stringify(d));
const saveOfflineAreas = async d  => AsyncStorage.setItem('offline_areas',JSON.stringify(d));

// ─── OFFLINE ──────────────────────────────────────────────────────────────────
const getQ   = async () => { const r=await AsyncStorage.getItem('oq'); return r?JSON.parse(r):[]; };
const pushQ  = async i  => { const q=await getQ(); q.push({...i,at:new Date().toISOString()}); await AsyncStorage.setItem('oq',JSON.stringify(q)); };
const clearQ = ()       => AsyncStorage.removeItem('oq');

// ─── UTILS ────────────────────────────────────────────────────────────────────
const hav = (a,b,c,d) => {
  const R=6371000, dL=(c-a)*Math.PI/180, dO=(d-b)*Math.PI/180;
  const x=Math.sin(dL/2)**2+Math.cos(a*Math.PI/180)*Math.cos(c*Math.PI/180)*Math.sin(dO/2)**2;
  return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
};

const normalizeStopType = value => {
  const t = String(value || '').toLowerCase();
  if (['train', 'station', 'halt'].includes(t)) return 'train';
  return 'bus';
};

const formatDistanceMeters = meters => {
  const n = Number(meters);
  if (!Number.isFinite(n)) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)} km`;
  return `${Math.round(n)} m`;
};

const toPoiFeatures = (items = [], kind) => ({
  type: 'FeatureCollection',
  features: items
    .filter(item => Number.isFinite(Number(item.longitude)) && Number.isFinite(Number(item.latitude)))
    .map((item, index) => ({
      type: 'Feature',
      id: `${kind}-${item.osm_id || item.id || index}`,
      properties: {
        ...item,
        kind,
        stop_type: normalizeStopType(item.stop_type),
        distance_label: formatDistanceMeters(item.distance),
      },
      geometry: {
        type: 'Point',
        coordinates: [Number(item.longitude), Number(item.latitude)],
      },
    })),
});

// ─── NOTIFIKACE ───────────────────────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({ 
    shouldShowBanner: true, 
    shouldPlaySound: true, 
    shouldSetBadge: false 
  }),
});

// Request permissions + register push token
async function setupPushNotifications(userId) {
  if (Platform.OS === 'web') return;
  
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync({
      expoPushToken: true,
    });
    finalStatus = status;
  }
  if (finalStatus !== 'granted') {
    console.log('Push notifications not granted – skipping token registration.');
    return;
  }

  try {
    const token = (await Notifications.getExpoPushTokenAsync({
      projectId: 'e549e18b-82ac-48e2-a4f1-de06e3b76931',
    })).data;
    console.log('Expo push token:', token);
    await apiFetch('/notifications/token', { method: 'POST', body: JSON.stringify({ token }) });
  } catch (e) {
    console.warn('Push token registration failed (non-fatal):', e);
  }
}

// Handle incoming notifications
Notifications.addNotificationReceivedListener(notification => {
  console.log('Notifikace přijata:', notification);
});

// Handle notification response (tap)
Notifications.addNotificationResponseReceivedListener(response => {
  console.log('Notifikace tap:', response);
  const data = response.notification.request.content.data;
  if (data.type === 'like') {
    // Open gallery or specific photo
  } else if (data.type === 'follow') {
    // Open Community tab
  } else if (data.type === 'chat_reply') {
    // Open chat
  } else if (data.type === 'visit') {
    // Open map with pub
  }
});


async function scheduleLocalNotification(title, body) {
  await Notifications.scheduleNotificationAsync({
    content: { title, body },
    trigger: null,
  });
}

// ─── BACKGROUND TASK PRO VERZI DATASETU ───────────────────────────────────────
const DATASET_CHECK_TASK = 'DATASET_CHECK';

TaskManager.defineTask(DATASET_CHECK_TASK, async () => {
  try {
    const offlineAreas = await getOfflineAreas();
    for (const code of offlineAreas) {
      const lastVersion = await AsyncStorage.getItem(`version_${code}`);
      if (!lastVersion) continue;
      const res = await fetch(`${API}/pubs/version`);
      if (!res.ok) continue;
      const { version } = await res.json();
      if (lastVersion !== version) {
        await scheduleLocalNotification(
          'Aktualizace hospůdek',
          `Pro oblast ${code} je k dispozici nová verze. Otevřete aplikaci pro stažení.`
        );
      }
    }
    try{
      const BF = require('expo-background-fetch');
      return BF?.Result?.NewData || 'NewData';
    }catch(e){
      return 'NewData';
    }
  } catch (e) {
    try{
      const BF = require('expo-background-fetch');
      return BF?.Result?.Failed || 'Failed';
    }catch(ex){
      return 'Failed';
    }
  }
});

async function registerBackgroundFetch() {
  try{
    const BF = require('expo-background-fetch');
    const status = await BF.getStatusAsync();
    if (status !== BF.Status.Available) return;
    await BF.registerTaskAsync(DATASET_CHECK_TASK, {
      minimumInterval: 5 * 60, // 5 minut
      stopOnTerminate: false,
      startOnBoot: true,
    });
  }catch(e){
    // expo-background-fetch není dostupné nebo je deprecated — přeskočíme registraci
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// SHARED COMPONENTS
// ══════════════════════════════════════════════════════════════════════════════

// Avatar with error fallback
const Avatar = ({ url, size=40, style, onPress }) => {
  const [err, setErr] = useState(false);
  const Inner = () => url && !err
    ? <Image source={{uri:url}} style={{width:size,height:size,borderRadius:size/2,borderWidth:2,borderColor:C.amber}} onError={()=>setErr(true)} />
    : <View style={{width:size,height:size,borderRadius:size/2,backgroundColor:C.bgCardAlt,borderWidth:2,borderColor:C.border,alignItems:'center',justifyContent:'center'}}>
        <Ionicons name="person" size={size*0.45} color={C.creamDim} />
      </View>;
  if (onPress) return <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={style}><Inner /></TouchableOpacity>;
  return <View style={style}><Inner /></View>;
};

const Stars = ({ rating, size=14, interactive=false, onRate }) => (
  <View style={{flexDirection:'row',gap:2}}>
    {[1,2,3,4,5].map(i=>(
      <TouchableOpacity key={i} disabled={!interactive} onPress={()=>onRate?.(i)} activeOpacity={0.7}>
        <Ionicons name={i<=rating?'star':'star-outline'} size={size} color={C.star} />
      </TouchableOpacity>
    ))}
  </View>
);

const Chip = ({ label, color = C.amber, icon }) => (
  <View style={[s.chip,{borderColor:color}]}>
    {icon && <Ionicons name={icon} size={11} color={color} style={{marginRight:3}} />}
    <Text style={[s.chipText,{color}]}>{label}</Text>
  </View>
);

// ─── FOLLOW BUTTON ───────────────────────────────────────────────────────────
const FollowButton = ({ userId, isFollowing, onFollowChange, size='normal' }) => {
  const [following, setFollowing] = useState(isFollowing);
  const [loading, setLoading] = useState(false);

  const toggleFollow = async () => {
    setLoading(true);
    try {
      if (following) {
        await unfollowUser(userId);
        setFollowing(false);
        onFollowChange?.(false);
      } else {
        await followUser(userId);
        setFollowing(true);
        onFollowChange?.(true);
      }
    } catch (e) {
      Alert.alert('Chyba', 'Nepodařilo se aktualizovat sledování.');
    }
    setLoading(false);
  };

  const btnStyle = size === 'small' 
    ? { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 }
    : { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20 };

  return (
    <TouchableOpacity 
      style={[
        btnStyle,
        {
          backgroundColor: following ? C.red : C.amber,
          borderWidth: 1,
          borderColor: following ? C.red : C.amber,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: loading ? 0.6 : 1
        }
      ]}
      onPress={toggleFollow}
      disabled={loading}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator size="small" color={following ? C.white : C.bg} />
      ) : (
        <>
          <Ionicons 
            name={following ? 'person-remove' : 'person-add'} 
            size={size === 'small' ? 14 : 16}
            color={following ? C.white : C.bg} 
          />
          <Text style={{
            fontWeight: '700',
            fontSize: size === 'small' ? 12 : 14,
            color: following ? C.white : C.bg,
            marginLeft: 4
          }}>
            {following ? 'Od sledovat' : 'Sledovat'}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const getPhotoLikeId = photo => photo?.id ?? photo?.photo_id ?? null;


// Fullscreen photo viewer with likes and author click
const PhotoViewer = ({ photos, startIndex, onClose, userId, onLikeUpdate }) => {
  const [cur, setCur] = useState(startIndex);
  const [likedState, setLikedState] = useState(photos.map(p => p.liked || false));
  const [likeCounts, setLikeCounts] = useState(photos.map(p => p.like_count || 0));
  const [userModal, setUserModal] = useState(null);
  const fa = useRef(new Animated.Value(0)).current;
  const currentPhoto = photos[cur];
  const currentPhotoLikeId = getPhotoLikeId(currentPhoto);

  useEffect(()=>{ Animated.timing(fa,{toValue:1,duration:200,useNativeDriver:true}).start(); },[]);
  const close = ()=>{ Animated.timing(fa,{toValue:0,duration:150,useNativeDriver:true}).start(onClose); };

  const handleLike = async () => {
    const photo = photos[cur];
    const photoLikeId = getPhotoLikeId(photo);
    if (!photoLikeId) return;
    const newLiked = !likedState[cur];
    setLikedState(prev => { const n=[...prev]; n[cur]=newLiked; return n; });
    setLikeCounts(prev => { const n=[...prev]; n[cur]=prev[cur] + (newLiked ? 1 : -1); return n; });
    try {
      const res = await apiFetch(`/community/gallery/${photoLikeId}/like`, { method: 'POST' });
      if (onLikeUpdate) onLikeUpdate(photoLikeId, res.liked, res.like_count);
    } catch (e) {
      // revert
      setLikedState(prev => { const n=[...prev]; n[cur]=!newLiked; return n; });
      setLikeCounts(prev => { const n=[...prev]; n[cur]=prev[cur] + (newLiked ? -1 : 1); return n; });
    }
  };

  return (
    <Modal visible animationType="none" transparent statusBarTranslucent>
      <Animated.View style={[s.pvBg,{opacity:fa}]}>
        <Image source={{uri:photos[cur].url}} style={s.pvImg} resizeMode="contain" />
        <View style={s.pvFooter}>
          <TouchableOpacity onPress={() => setUserModal(photos[cur].username)}>
            <Text style={s.pvAuthor}>{photos[cur].username}</Text>
          </TouchableOpacity>
          {currentPhotoLikeId ? (
            <View style={{flexDirection:'row',alignItems:'center',gap:8}}>
              <TouchableOpacity onPress={handleLike}>
                <Ionicons name={likedState[cur] ? 'heart' : 'heart-outline'} size={24} color={likedState[cur] ? C.red : C.white} />
              </TouchableOpacity>
              <Text style={s.pvLikeCount}>{likeCounts[cur]}</Text>
            </View>
          ) : <View />}
        </View>
        {photos.length>1 && (
          <View style={s.pvNav}>
            <TouchableOpacity style={[s.pvBtn,cur===0&&s.pvBtnOff]} onPress={()=>cur>0&&setCur(c=>c-1)}>
              <Ionicons name="chevron-back" size={26} color={cur===0?C.creamDim:C.amber} />
            </TouchableOpacity>
            <Text style={s.pvCount}>{cur+1} / {photos.length}</Text>
            <TouchableOpacity style={[s.pvBtn,cur===photos.length-1&&s.pvBtnOff]} onPress={()=>cur<photos.length-1&&setCur(c=>c+1)}>
              <Ionicons name="chevron-forward" size={26} color={cur===photos.length-1?C.creamDim:C.amber} />
            </TouchableOpacity>
          </View>
        )}
        <TouchableOpacity style={s.pvClose} onPress={close}>
          <Ionicons name="close" size={26} color={C.white} />
        </TouchableOpacity>
      </Animated.View>
      {userModal && <UserProfileModal username={userModal} selfId={userId} onClose={()=>setUserModal(null)} />}
    </Modal>
  );
};

const TutorialModal = ({ visible, onClose }) => {
  useEffect(() => {
    if (visible) setStep(0);
  }, [visible]);
  const steps = [
    { icon: "map-outline", title: "Mapa hospůdek", desc: "Na mapě uvidíš všechny hospůdky. Zelené jsou navštívené, oranžové čekají na odkliknutí." },
    { icon: "locate-outline", title: "GPS poloha", desc: "Aplikace používá tvou polohu k ověření, že jsi skutečně u hospůdky. Musíš být do 25 metrů." },
    { icon: "checkbox-outline", title: "Odkliknutí", desc: "Klepni na hospůdku, odpověz na otázku, dej hodnocení a přidej fotku. Získáš body do žebříčku." },
    { icon: "trophy-outline", title: "Výzvy a prvochlasty", desc: "Plněním výzev sbíráš odznaky. Kdo je první v daném roce v hospůdce, získává titul Prvochlast." },
    { icon: "download-outline", title: "Offline režim", desc: "Stáhni si zvlášť mapové podklady i hospůdky. Offline mapa funguje jen pro již stažené oblasti." },
    { icon: "train-outline", title: "Doprava a parkování", desc: "U detailu hospůdky i na mapě uvidíš nejbližší vlakové a autobusové zastávky a veřejná parkoviště." },
    { icon: "people-outline", title: "Komunita", desc: "Sleduj žebříčky, piš do chatu, prohlížej fotky ostatních a vyhledávej hráče včetně jejich posledních odkliků." },
  ];
  const [step, setStep] = useState(0);
  const stepData = steps[step];
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <View style={[s.modalCard, {maxHeight: SH*0.8}]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Vítej v Hospůdkobraní! 🍺</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
          </View>
          <View style={{alignItems: 'center', marginVertical: 20}}>
            <Ionicons name={stepData.icon} size={64} color={C.amber} />
            <Text style={[s.modalTitle, {fontSize: 22, marginTop: 12}]}>{stepData.title}</Text>
            <Text style={[s.dimText, {textAlign: 'center', marginTop: 8, paddingHorizontal: 16}]}>{stepData.desc}</Text>
          </View>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', marginTop: 20}}>
            {step > 0 && (
              <TouchableOpacity style={s.btnSec} onPress={() => setStep(s => s-1)}>
                <Text style={{color: C.creamDim}}>Zpět</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[s.btnPri, {flex: step === 0 ? 1 : 0.5, marginLeft: step > 0 ? 10 : 0}]} onPress={() => {
              if (step < steps.length-1) setStep(s => s+1);
              else onClose();
            }}>
              <Text style={s.btnPriT}>{step === steps.length-1 ? 'Začít hrát!' : 'Další'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

// ─── FOLLOWERS/FOLLOWING LISTS MODALS ───────────────────────────────────────
const FollowersListModal = ({ userId, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [userModal, setUserModal] = useState(null);

  useEffect(() => {
    apiFetch(`/users/${userId}/followers`).then(setUsers).finally(() => setLoading(false));
  }, [userId]);

  return (
    <Modal visible={true} animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <View style={[s.modalCard, { maxHeight: SH * 0.7 }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Sledující ({users.length})</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim} /></TouchableOpacity>
          </View>
          {loading ? (
            <ActivityIndicator color={C.amber} style={{ margin: 24 }} />
          ) : (
            <FlatList
              data={users}
              keyExtractor={u => String(u.id)}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={[s.lbRow, { marginBottom: 6, padding: 12 }]}
                  onPress={() => setUserModal(item.username)}
                  activeOpacity={0.8}
                >
                  <Avatar url={item.avatar_url} size={40} />
                  <Text style={{ color: C.cream, fontWeight: '700', marginLeft: 10, flex: 1 }}>{item.username}</Text>
                </TouchableOpacity>
              )}
              contentContainerStyle={{ padding: 8 }}
            />
          )}
        </View>
        {userModal && <UserProfileModal username={userModal} selfId={userId} onClose={() => setUserModal(null)} />}
      </View>
    </Modal>
  );
};


const FollowingListModal = ({ userId, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [userModal, setUserModal] = useState(null);

  useEffect(() => {
    apiFetch(`/users/${userId}/following`).then(setUsers).finally(() => setLoading(false));
  }, [userId]);

  return (
    <Modal visible={true} animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <View style={[s.modalCard, { maxHeight: SH * 0.7 }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Sleduje ({users.length})</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim} /></TouchableOpacity>
          </View>
          {loading ? (
            <ActivityIndicator color={C.amber} style={{ margin: 24 }} />
          ) : (
            <FlatList
              data={users}
              keyExtractor={u => String(u.id)}
              renderItem={({ item }) => (
                <TouchableOpacity 
                  style={[s.lbRow, { marginBottom: 6, padding: 12 }]}
                  onPress={() => setUserModal(item.username)}
                  activeOpacity={0.8}
                >
                  <Avatar url={item.avatar_url} size={40} />
                  <Text style={{ color: C.cream, fontWeight: '700', marginLeft: 10, flex: 1 }}>{item.username}</Text>
                </TouchableOpacity>
              )}
              contentContainerStyle={{ padding: 8 }}
            />
          )}
        </View>
        {userModal && <UserProfileModal username={userModal} selfId={userId} onClose={() => setUserModal(null)} />}
      </View>
    </Modal>
  );
};

// ─── ENHANCED USER PROFILE MODAL (with follow system) ─────────────────────────
const UserProfileModal = ({ username, selfId, onClose }) => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bigAvatar, setBigAvatar] = useState(false);
  const [followersModal, setFollowersModal] = useState(false);
  const [followingModal, setFollowingModal] = useState(false);
  const [followState, setFollowState] = useState(false);
  
  useEffect(() => {
    apiFetch(`/users/find?q=${encodeURIComponent(username)}`).then(setProfile).catch(()=>setProfile(null)).finally(()=>setLoading(false));
  }, [username, selfId]);

  useEffect(() => {
    if (profile) {
      // Refresh follow status
      apiFetch(`/users/find?q=${encodeURIComponent(username)}`)
        .then(updatedProfile => {
          if (updatedProfile) {
            setProfile(updatedProfile);
            setFollowState(updatedProfile.is_following || false);
          }
        })
        .catch(() => {});
    }
  }, [followState]);

  useEffect(() => {
    if (!profile) return;
    setFollowState(profile.is_following || false);
  }, [profile]);

  const isSelf = profile && profile.id === selfId;
  const recentVisits = Array.isArray(profile?.visits) ? profile.visits.slice(0, 5) : [];

  const handleFollowChange = (newFollowing) => {
    setFollowState(newFollowing);
    // Refresh profile data
    if (profile) {
      setProfile(prev => ({ ...prev, is_following: newFollowing }));
    }
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={C.amber} /></View>;

  const avatarVisible = profile?.avatar_url && (
    profile.avatar_privacy === 'public' || 
    isSelf || 
    profile.is_following
  );

  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <View style={[s.modalCard, { maxHeight: SH * 0.75 }]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Profil Hospůdkobraníka</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim} /></TouchableOpacity>
          </View>
          {!profile ? (
            <Text style={[s.dimText, { margin: 20 }]}>Profil nenalezen.</Text>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ alignItems: 'center', paddingVertical: 10 }}>
                <Avatar 
                  url={avatarVisible ? profile.avatar_url : null} 
                  size={80}
                  onPress={isSelf ? undefined : () => setBigAvatar(true)}
                  style={{ marginBottom: 10 }} 
                />
                {!isSelf && !avatarVisible && (
                  <Text style={[s.dimText, { fontSize: 11, marginBottom: 8 }]}>
                    Profilovka je soukromá (pouze pro sledující)
                  </Text>
                )}
                {!isSelf && avatarVisible && (
                  <Text style={[s.dimText, { fontSize: 11, marginBottom: 8 }]}>
                    Klepni na foto pro zvětšení
                  </Text>
                )}
                <Text style={s.profileName}>{profile.username}</Text>
                {profile.bio && <Text style={[s.bioText, { marginTop: 6, paddingHorizontal: 10 }]}>{profile.bio}</Text>}
                
                {/* Follow stats row */}
                {!isSelf && (
                  <View style={{ flexDirection: 'row', gap: 20, marginTop: 14, marginBottom: 12 }}>
                    <TouchableOpacity 
                      style={s.followStatBox}
                      onPress={() => setFollowersModal(true)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.followStatNum, { color: C.purple }]}>{profile.followers_count}</Text>
                      <Text style={[s.followStatLabel, {color: C.white}]}>Sledující</Text>
                    </TouchableOpacity>
                    <TouchableOpacity 
                      style={s.followStatBox}
                      onPress={() => setFollowingModal(true)}
                      activeOpacity={0.8}
                    >
                      <Text style={[s.followStatNum, { color: C.amber }]}>{profile.following_count}</Text>
                      <Text style={[s.followStatLabel, {color: C.white}]}>Sleduje</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {/* Follow button */}
                {!isSelf && (
                  <FollowButton 
                    userId={profile.id} 
                    isFollowing={followState}
                    onFollowChange={handleFollowChange}
                    size="normal"
                  />
                )}

                {/* Main stats */}
                <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                  <View style={s.statBox}><Text style={s.statNum}>{profile.total_visits}</Text><Text style={s.statLabel}>hospůdek</Text></View>
                  <View style={s.statBox}><Text style={s.statNum}>{profile.avg_rating?.toFixed(1) ?? '–'}</Text><Text style={s.statLabel}>průměr ⭐</Text></View>
                  {profile.firstlast_count > 0 && (
                    <View style={s.statBox}><Text style={s.statNum}>{profile.firstlast_count}</Text><Text style={s.statLabel}>prvochlasty</Text></View>
                  )}
                </View>
                <Text style={[s.dimText, { marginTop: 12, fontSize: 11 }]}>
                  Člen od {new Date(profile.created_at).toLocaleDateString('cs-CZ')}
                </Text>
              </View>

              {/* Recent visits */}
              {recentVisits.length > 0 && (
                <View style={{ marginTop: 20 }}>
                  <Text style={[s.secLabel, { fontSize: 14 }]}>Nedávné návštěvy</Text>
                  {recentVisits.map((v, i) => (
                    <View key={i} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.bgCardAlt, borderRadius: 10, padding: 8, marginBottom: 6 }}>
                      <View>
                        <Text style={{ color: C.cream, fontWeight: '700' }}>{v.pub_name}</Text>
                        <Stars rating={v.rating} size={10} />
                        {v.note && <Text style={{ color: C.creamDim, fontSize: 11, fontStyle: 'italic' }}>"{v.note.substring(0, 50)}"</Text>}
                      </View>
                      <Text style={[s.dimText, { fontSize: 10 }]}>{new Date(v.logged_at).toLocaleDateString('cs-CZ')}</Text>
                    </View>
                  ))}
                </View>
              )}
            </ScrollView>
          )}
        </View>

        {/* Modals */}
        {bigAvatar && profile?.avatar_url && (
          <PhotoViewer 
            photos={[{ url: profile.avatar_url, username: profile.username, id: null, liked: false, like_count: 0 }]} 
            startIndex={0} 
            onClose={() => setBigAvatar(false)} 
            userId={selfId} 
          />
        )}
        {followersModal && <FollowersListModal userId={profile?.id} onClose={() => setFollowersModal(false)} />}
        {followingModal && <FollowingListModal userId={profile?.id} onClose={() => setFollowingModal(false)} />}
      </View>
    </Modal>
  );
};

// PUB DETAIL MODAL (with likes on photos)
// ══════════════════════════════════════════════════════════════════════════════
const PubDetailModal = ({ pub, onClose, userId, nearbyTransport }) => {
  const [reviews, setReviews]     = useState([]);
  const [photos, setPhotos]       = useState([]);
  const [firstlasts, setFirstlasts] = useState([]);
  const [transportData, setTransportData] = useState(nearbyTransport || { stops: [], parking: [] });
  const [loading, setLoading]     = useState(true);
  const [pv, setPv]               = useState(null);
  const [userModal, setUserModal] = useState(null);
  const [reportMod, setReportMod] = useState(false);

  useEffect(()=>{
    setTransportData(nearbyTransport || { stops: [], parking: [] });
  }, [nearbyTransport, pub.id]);

  useEffect(()=>{
    Promise.all([
      apiFetch(`/pubs/${pub.id}/reviews`).catch(()=>[]),
      apiFetch(`/pubs/${pub.id}/photos`).catch(()=>[]),
      apiFetch(`/pubs/${pub.id}/firstlasts`).catch(()=>[]),
      apiFetch(`/transport/nearby?lat=${pub.latitude}&lng=${pub.longitude}&radius=1500`).catch(()=>({ stops: [], parking: [] })),
    ]).then(([r,p,fl,tp])=>{
      setReviews(r);
      setPhotos(p);
      setFirstlasts(fl);
      setTransportData(tp || { stops: [], parking: [] });
      setLoading(false);
    });
  },[pub.id, pub.latitude, pub.longitude]);

  const handleLikeUpdate = (photoId, liked, likeCount) => {
    setPhotos(prev => prev.map(p => p.id === photoId ? {...p, liked, like_count: likeCount} : p));
  };

  const deleteMyPhoto = (photoId) => {
    Alert.alert('Smazat fotku?', 'Tuto akci nelze vrátit.', [
      { text: 'Zrušit', style: 'cancel' },
      { text: 'Smazat', style: 'destructive', onPress: async () => {
        try {
          await apiFetch('/photos/' + photoId, { method: 'DELETE' });
          setPhotos(prev => prev.filter(ph => ph.id !== photoId));
        } catch(e) { Alert.alert('Chyba', 'Nepodařilo se smazat fotku.'); }
      }},
    ]);
  };

  const sharePub = () => {
    (async () => {
      try {
        const res = await apiFetch(`/pubs/${pub.id}/share`);
        const web = res.web_url || res.url || `https://hospudkobrani-8888.rostiapp.cz/pub/${pub.id}`;
        const appLink = res.app_link || `hospudkobrani://pub/${pub.id}`;
        // Share web link (recipients without app will see web page); include app link for clients that support it
        await Share.share({
          message: `Podívej se na hospůdku „${pub.name}" v Hospůdkobraní!\n${web}\n${appLink}`,
          title: pub.name,
        });
      } catch (e) {
        // fallback
        Share.share({ message: `https://hospudkobrani-8888.rostiapp.cz/pub/${pub.id}`, title: pub.name }).catch(()=>{});
      }
    })();
  };

  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <View style={[s.modalCard,{maxHeight:SH*0.88}]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{pub.name}</Text>
            <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
              <TouchableOpacity onPress={sharePub}>
                <Ionicons name="share-outline" size={19} color={C.creamDim}/>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>{
                const lat=pub.latitude, lng=pub.longitude, label=encodeURIComponent(pub.name);
                const url=Platform.OS==='ios'
                  ? `maps://?q=${label}&ll=${lat},${lng}&dirflg=d`
                  : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
                Linking.canOpenURL(url).then(ok=>{
                  if(ok){ Linking.openURL(url); }
                  else { Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`); }
                });
              }}>
                <Ionicons name="navigate-outline" size={19} color={C.teal}/>
              </TouchableOpacity>
              <TouchableOpacity onPress={()=>setReportMod(true)}>
                <Ionicons name="flag-outline" size={19} color={C.creamDim}/>
              </TouchableOpacity>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
            </View>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:6,marginBottom:10}}>
              <Chip label={pub.type} color={C.amber} icon="storefront-outline" />
              {pub.card_payment && <Chip label="Karty" color={C.green} icon="card-outline" />}
              {pub.avg_rating>0 && (
                <View style={{flexDirection:'row',alignItems:'center',gap:4}}>
                  <Stars rating={Math.round(pub.avg_rating)} size={13}/>
                  <Text style={s.dimText}>{pub.avg_rating?.toFixed(1)} ({pub.visit_count})</Text>
                </View>
              )}
              {pub.is_firstlast && <Chip label="Prvochlast" color={C.purple} icon="ribbon-outline"/>}
            </View>

            {pub.address && (
              <TouchableOpacity style={{flexDirection:'row',alignItems:'center',gap:6,marginBottom:6}} activeOpacity={0.7}
                onPress={()=>{
                  const lat=pub.latitude, lng=pub.longitude, label=encodeURIComponent(pub.name);
                  const url=Platform.OS==='ios'
                    ? `maps://?q=${label}&ll=${lat},${lng}&dirflg=d`
                    : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
                  Linking.canOpenURL(url).then(ok=>{
                    if(ok){ Linking.openURL(url); }
                    else { Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`); }
                  });
                }}>
                <Ionicons name="navigate-outline" size={14} color={C.teal}/>
                <Text style={[s.dimText,{color:C.teal,textDecorationLine:'underline',flex:1}]}>{pub.address}</Text>
                <Ionicons name="open-outline" size={12} color={C.teal}/>
              </TouchableOpacity>
            )}
            {pub.opening_hours && (
              <View style={{flexDirection:'row',alignItems:'center',gap:6,marginBottom:6}}>
                <Ionicons name="time-outline" size={14} color={C.creamDim}/>
                <Text style={s.dimText}>{pub.opening_hours}</Text>
              </View>
            )}
            {pub.note && (
              <View style={s.noteBox}>
                <Ionicons name="warning-outline" size={14} color={C.gold}/>
                <Text style={{color:C.gold,fontSize:13,flex:1}}>{pub.note}</Text>
              </View>
            )}
            {pub.beers && (
              <View style={{marginTop:10}}>
                <Text style={s.secLabel}>Točená piva</Text>
                <View style={{flexDirection:'row',flexWrap:'wrap',gap:6}}>
                  {pub.beers.split(',').map(b=>b.trim()).filter(Boolean).map((b,i)=>(
                    <Chip key={i} label={b} color={C.amber} icon="beer-outline"/>
                  ))}
                </View>
              </View>
            )}

            {!loading && ((transportData?.stops?.length || 0) > 0 || (transportData?.parking?.length || 0) > 0) && (
              <View style={{marginTop:14}}>
                <Text style={s.secLabel}>Doprava v okolí</Text>
                {(transportData?.stops || []).slice(0, 5).map((stop, i) => (
                  <View key={`stop-${i}`} style={s.poiRow}>
                    <View style={[s.poiIconWrap, { backgroundColor: normalizeStopType(stop.stop_type) === 'train' ? 'rgba(142,68,173,0.18)' : 'rgba(41,128,185,0.18)' }]}>
                      <Ionicons
                        name={normalizeStopType(stop.stop_type) === 'train' ? 'train-outline' : 'bus-outline'}
                        size={16}
                        color={normalizeStopType(stop.stop_type) === 'train' ? C.purple : C.blue}
                      />
                    </View>
                    <View style={{flex:1}}>
                      <Text style={s.poiName}>{stop.name || 'Zastávka'}</Text>
                      <Text style={s.dimText}>
                        {normalizeStopType(stop.stop_type) === 'train' ? 'Vlak / nádraží' : 'Bus / MHD'} · {formatDistanceMeters(stop.distance)}
                      </Text>
                    </View>
                  </View>
                ))}
                {(transportData?.parking || []).slice(0, 5).map((park, i) => (
                  <View key={`park-${i}`} style={s.poiRow}>
                    <View style={[s.poiIconWrap, { backgroundColor: 'rgba(22,160,133,0.18)' }]}>
                      <Ionicons name="car-outline" size={16} color={C.teal} />
                    </View>
                    <View style={{flex:1}}>
                      <Text style={s.poiName}>{park.name || 'Parkoviště'}</Text>
                      <Text style={s.dimText}>
                        {formatDistanceMeters(park.distance)}
                        {park.capacity ? ` · kapacita ${park.capacity}` : ''}
                        {park.fee ? ' · placené' : ' · zdarma / neuvedeno'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {loading ? <ActivityIndicator color={C.amber} style={{marginVertical:20}}/> : (
              <>
                {photos.length>0 && (
                  <View style={{marginTop:14}}>
                    <Text style={s.secLabel}>Fotky ({photos.length})</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {photos.map((p,i)=>(
                        <View key={i} style={{position:'relative',marginRight:8}}>
                          <TouchableOpacity onPress={()=>setPv(i)} activeOpacity={0.85}>
                            <Image source={{uri:p.url}} style={{width:120,height:90,borderRadius:10}} resizeMode="cover"/>
                            <View style={s.expandOverlay}><Ionicons name="expand-outline" size={14} color={C.white}/></View>
                          </TouchableOpacity>
                          {p.visibility==='private' && (
                            <View style={{position:'absolute',top:4,left:4,backgroundColor:'rgba(0,0,0,0.65)',borderRadius:8,padding:3}}>
                              <Ionicons name="lock-closed" size={11} color={C.amber}/>
                            </View>
                          )}
                          {getPhotoLikeId(p) && p.visibility!=='private' ? (
                            <TouchableOpacity style={s.photoLikeBtnMini} onPress={async()=>{
                              const photoLikeId = getPhotoLikeId(p);
                              const newLiked = !p.liked;
                              setPhotos(prev => prev.map(ph => getPhotoLikeId(ph) === photoLikeId ? {...ph, liked:newLiked, like_count: (ph.like_count||0)+(newLiked?1:-1)} : ph));
                              try { await apiFetch(`/community/gallery/${photoLikeId}/like`, { method:'POST' }); }
                              catch(e){ setPhotos(prev => prev.map(ph => getPhotoLikeId(ph) === photoLikeId ? {...ph, liked:!newLiked, like_count: (ph.like_count||0)+(newLiked?-1:1)} : ph)); }
                            }}>
                              <Ionicons name={p.liked?'heart':'heart-outline'} size={12} color={p.liked?C.red:C.white}/>
                              <Text style={{color:C.white,fontSize:9,marginLeft:2}}>{p.like_count||0}</Text>
                            </TouchableOpacity>
                          ) : null}
                          {p.username===String(userId)||Number(p.user_id)===Number(userId) ? (
                            <TouchableOpacity
                              onPress={()=>deleteMyPhoto(p.id)}
                              style={{position:'absolute',top:4,right:4,backgroundColor:'rgba(0,0,0,0.65)',borderRadius:8,padding:3}}>
                              <Ionicons name="trash-outline" size={13} color={C.red}/>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      ))}
                    </ScrollView>
                  </View>
                )}
                {firstlasts.length>0 && (
                  <View style={{marginTop:14}}>
                    <Text style={s.secLabel}>Prvochlasté 🎖</Text>
                    {firstlasts.map((fl,i)=>(
                      <View key={i} style={{flexDirection:'row',alignItems:'center',gap:8,marginBottom:6,backgroundColor:C.bgCardAlt,borderRadius:10,padding:8,borderWidth:1,borderColor:fl.is_this_year?C.purple:C.border}}>
                        <Ionicons name="ribbon-outline" size={16} color={fl.is_this_year?C.purple:C.creamDim}/>
                        <Text style={{color:fl.is_this_year?C.purple:C.amber,fontWeight:'800',fontSize:14}}>{fl.year}</Text>
                        <TouchableOpacity onPress={()=>setUserModal(fl.username)} style={{flex:1}}>
                          <Text style={{color:C.cream,textDecorationLine:'underline',fontWeight:'600'}}>{fl.username}</Text>
                        </TouchableOpacity>
                        {fl.is_this_year && <Chip label="Letos!" color={C.green}/>}
                      </View>
                    ))}
                  </View>
                )}
                <View style={{marginTop:14}}>
                  <Text style={s.secLabel}>Hodnocení Hospůdkobraníků {reviews.length>0?`(${reviews.length})`:''}</Text>
                  {reviews.length===0 && <Text style={s.dimText}>Zatím žádné hodnocení. Buď první!</Text>}
                  {reviews.map((r,i)=>(
                    <View key={i} style={s.reviewCard}>
                      <View style={{flexDirection:'row',alignItems:'center'}}>
                        <TouchableOpacity style={{flexDirection:'row',alignItems:'center',flex:1,gap:8}}
                          onPress={()=>setUserModal(r.username)} activeOpacity={0.7}>
                          <Avatar url={r.avatar_url} size={32}/>
                          <View>
                            <Text style={[s.reviewUser,{textDecorationLine:'underline'}]}>{r.username}</Text>
                            <Stars rating={r.rating} size={11}/>
                          </View>
                        </TouchableOpacity>
                        <Text style={s.dimText}>{new Date(r.logged_at).toLocaleDateString('cs-CZ')}</Text>
                      </View>
                      {r.note ? <Text style={s.reviewNote}>"{r.note}"</Text> : null}
                    </View>
                  ))}
                </View>
              </>
            )}
          </ScrollView>
        </View>
      </View>
      {pv!==null && <PhotoViewer photos={photos} startIndex={pv} onClose={()=>setPv(null)} userId={userId} onLikeUpdate={handleLikeUpdate} />}
      {userModal && <UserProfileModal username={userModal} selfId={userId} onClose={()=>setUserModal(null)}/>}
      {reportMod && <ReportPubModal pub={pub} onClose={()=>setReportMod(false)}/>}
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// FILTER MODAL
// ══════════════════════════════════════════════════════════════════════════════
const PUB_TYPES = ['hospoda','restaurace','hostinec','kiosek','jiné'];
const DEF_FILTERS = { visited:'all', types:[], card:'any', minRating:0, beer:'' };

// ─── GRAPHHOPPER ──────────────────────────────────────────────────────────────
const GRAPHHOPPER_KEY = '5e74a4a1-54f4-456b-8e4f-e12a18a15b16';
const decodePoly = (encoded) => {
  const coords = []; let idx = 0, lat = 0, lng = 0;
  while (idx < encoded.length) {
    let b, shift = 0, result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(idx++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    coords.push([lng / 1e5, lat / 1e5]);
  }
  return coords;
};
const fetchGHRoute = async (waypoints, profile = 'foot') => {
  const pts = waypoints.map(p => `point=${p.lat},${p.lng}`).join('&');
  const url = `https://graphhopper.com/api/1/route?${pts}&profile=${profile}&locale=cs&calc_points=true&points_encoded=true&key=${GRAPHHOPPER_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Nelze naplánovat trasu');
  const data = await res.json();
  if (!data.paths?.length) throw new Error('Trasa nenalezena');
  const path = data.paths[0];
  return { coords: decodePoly(path.points), distance: path.distance, duration: Math.round(path.time / 60000) };
};

// ─── TRANSPORT MODES ─────────────────────────────────────────────────────────
const TRANSPORT_MODES = [
  { id: 'walk',  icon: 'walk-outline',       label: 'Pěšky',     gh: 'foot' },
  { id: 'bike',  icon: 'bicycle-outline',    label: 'Kolo',      gh: 'bike' },
  { id: 'car',   icon: 'car-outline',        label: 'Autem',     gh: 'car' },
  { id: 'ebike', icon: 'flash-outline',      label: 'E-kolo',    gh: 'bike' },
  { id: 'bus',   icon: 'bus-outline',        label: 'Busem',     gh: 'foot' },
  { id: 'moto',  icon: 'speedometer-outline',label: 'Moto',      gh: 'car' },
  { id: 'other', icon: 'ellipsis-horizontal-outline', label: 'Jinak', gh: 'foot' },
];

const FilterModal = ({ filters, onApply, onClose }) => {
  const [f, setF] = useState({...filters});
  const tog = t => setF(p=>({...p,types:p.types.includes(t)?p.types.filter(v=>v!==t):[...p.types,t]}));
  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <View style={s.modalCard}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Filtr podniků</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            <Text style={s.secLabel}>Stav návštěvy</Text>
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
              {[['all','Všechny'],['visited','Navštívené'],['unvisited','Nenavštívené']].map(([v,l])=>(
                <TouchableOpacity key={v} style={[s.fChip,f.visited===v&&s.fChipOn]} onPress={()=>setF(p=>({...p,visited:v}))}>
                  <Text style={[s.fChipT,f.visited===v&&s.fChipTOn]}>{l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[s.secLabel,{marginTop:14}]}>Typ podniku</Text>
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
              {PUB_TYPES.map(t=>{
                const on=f.types.length===0||f.types.includes(t);
                return <TouchableOpacity key={t} style={[s.fChip,on&&s.fChipOn]} onPress={()=>tog(t)}><Text style={[s.fChipT,on&&s.fChipTOn]}>{t}</Text></TouchableOpacity>;
              })}
            </View>
            <Text style={[s.secLabel,{marginTop:14}]}>Platba kartou</Text>
            <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
              {[['any','Nezáleží'],['yes','Jen karty'],['no','Jen hotovost']].map(([v,l])=>(
                <TouchableOpacity key={v} style={[s.fChip,f.card===v&&s.fChipOn]} onPress={()=>setF(p=>({...p,card:v}))}>
                  <Text style={[s.fChipT,f.card===v&&s.fChipTOn]}>{l}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[s.secLabel,{marginTop:14}]}>Min. hodnocení</Text>
            <View style={{flexDirection:'row',gap:8}}>
              {[0,1,2,3,4,5].map(v=>(
                <TouchableOpacity key={v} style={[s.fChip,{paddingHorizontal:10},f.minRating===v&&s.fChipOn]} onPress={()=>setF(p=>({...p,minRating:v}))}>
                  <Text style={[s.fChipT,f.minRating===v&&s.fChipTOn]}>{v===0?'Vše':`${v}★`}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={[s.secLabel,{marginTop:14}]}>Točí pivo</Text>
            <TextInput style={s.input} placeholder="např. Pilsner Urquell" placeholderTextColor={C.creamDim}
              value={f.beer} onChangeText={v=>setF(p=>({...p,beer:v}))} />
            <View style={{flexDirection:'row',gap:10,marginTop:4}}>
              <TouchableOpacity style={[s.btnSec,{flex:1}]} onPress={()=>{onApply({...DEF_FILTERS});onClose();}}>
                <Text style={{color:C.creamDim,fontWeight:'600',textAlign:'center'}}>Resetovat</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btnPri,{flex:1}]} onPress={()=>{onApply(f);onClose();}}>
                <Text style={s.btnPriT}>Použít</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// OFFLINE OBLASTI MODAL (with dataset version check)
// ══════════════════════════════════════════════════════════════════════════════
const OfflineRegionsModal = ({ onClose, onAreaDownloaded, userId }) => {
  const [areas, setAreas]         = useState([]);
  const [downloading, setDl]      = useState(null);
  const [pubCounts, setPubCounts] = useState({});
  const [versions, setVersions]   = useState({});
  const [progress, setProgress]   = useState({});
  const [packsReady, setPacksReady] = useState({});

  useEffect(()=>{ loadAreas(); },[]);

  useEffect(() => {
    if (!MapboxNative?.offlineManager) return;
    const sub = MapboxNative.offlineManager.subscribe((pack, status) => {
      const pct = status.percentage || 0;
      setProgress(prev => ({ ...prev, [pack.name]: pct }));
      const finished = status.state === 'complete' || pct >= 100;
      if (finished) {
        setPacksReady(prev => ({ ...prev, [pack.name]: true }));
      }
    });
    return () => sub?.remove?.();
  }, []);

  const loadAreas = async () => {
    const a = await getOfflineAreas(); setAreas(a);
    const pubs = await getOfflinePubs();
    const cnt = {};
    pubs.forEach(p=>{ if(p.country){ cnt[p.country]=(cnt[p.country]||0)+1; } });
    setPubCounts(cnt);
    // načíst verze
    const vers = {};
    for (const code of a) {
      const v = await AsyncStorage.getItem(`version_${code}`);
      if (v) vers[code] = v;
    }
    setVersions(vers);
    if (MapboxNative?.offlineManager) {
      try {
        const packs = await MapboxNative.offlineManager.getPacks();
        const ready = {};
        packs.forEach(pack => {
          ready[pack.name] = true;
        });
        setPacksReady(ready);
      } catch {}
    }
  };

  const download = async (country) => {
    // TASK 3: Warn on mobile data
    const net = await NetInfo.fetch();
    if (net.type !== 'wifi') {
      const proceed = await new Promise(resolve => {
        Alert.alert(
          'Stahování přes mobilní data',
          'Stahování map může mít stovky MB. Opravdu chceš pokračovat?',
          [
            { text: 'Zrušit', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Pokračovat', onPress: () => resolve(true) }
          ]
        );
      });
      if (!proceed) return;
    }

    setDl(country.code);
    try {
      // TASK 1: Check if map pack already exists
      if (MapboxNative?.offlineManager) {
        const packs = await MapboxNative.offlineManager.getPacks();
        const exists = packs.find(p => p.name === `map_${country.code}`);
        if (!exists) {
          await MapboxNative.offlineManager.createPack({
            name: `map_${country.code}`,
            styleURL: activeMapStyleUrl,
            bounds: [
              [country.bounds.minLng, country.bounds.minLat],
              [country.bounds.maxLng, country.bounds.maxLat]
            ],
            minZoom: 5,
            maxZoom: 16,
          });
        }
      }

      const fresh = await apiFetch(`/pubs?country=${country.code}`);
      const existing = await getOfflinePubs();
      const ids = new Set(fresh.map(p=>p.id));
      const merged = [...existing.filter(p=>!ids.has(p.id)), ...fresh.map(p=>({...p,country:country.code}))];
      await saveOfflinePubs(merged);
      const existing2 = await getOfflineAreas();
      if (!existing2.includes(country.code)) await saveOfflineAreas([...existing2, country.code]);
      // uložit verzi
      const verRes = await apiFetch('/pubs/version');
      await AsyncStorage.setItem(`version_${country.code}`, verRes.version);
      setAreas(a => [...new Set([...a, country.code])]);
      setPubCounts(c=>({...c,[country.code]:fresh.length}));
      setPacksReady(prev => ({ ...prev, [`map_${country.code}`]: true }));
      Alert.alert('Staženo ✓', `${country.name}: ${fresh.length} hospůdek uloženo offline. Mapový balík byl připraven pro offline použití.`);
      onAreaDownloaded?.();
    } catch(e) { Alert.alert('Chyba stahování', e.message); }
    setDl(null);
  };

  const checkForUpdates = async (code) => {
    const lastVer = await AsyncStorage.getItem(`version_${code}`);
    if (!lastVer) return;
    try {
      const serverVer = await apiFetch('/pubs/version');
      if (lastVer !== serverVer.version) {
        Alert.alert(
          'Aktualizace dostupná',
          `Pro ${code} je nová verze. Stáhnout nyní?`,
          [
            { text: 'Později', style: 'cancel' },
            { text: 'Stáhnout', onPress: () => downloadUpdates(code, lastVer) }
          ]
        );
      } else {
        Alert.alert('Aktuální', 'Máš nejnovější verzi hospůdek.');
      }
    } catch(e) { Alert.alert('Chyba', e.message); }
  };

  const downloadUpdates = async (code, since) => {
    setDl(code);
    try {
      const updates = await apiFetch(`/pubs/updates?since=${encodeURIComponent(since)}`);
      const existing = await getOfflinePubs();
      const newPubs = existing.map(p => {
        const upd = updates.find(u => u.id === p.id);
        return upd ? {...p, ...upd} : p;
      });
      const newIds = new Set(updates.map(u => u.id));
      const added = updates.filter(u => !existing.some(e => e.id === u.id));
      const merged = [...newPubs, ...added];
      await saveOfflinePubs(merged);
      const verRes = await apiFetch('/pubs/version');
      await AsyncStorage.setItem(`version_${code}`, verRes.version);
      setPubCounts(c=>({...c,[code]:merged.filter(p=>p.country===code).length}));
      Alert.alert('Aktualizováno', `Staženo ${updates.length} změn.`);
      onAreaDownloaded?.();
    } catch(e) { Alert.alert('Chyba', e.message); }
    setDl(null);
  };

  const remove = (code) => {
    const country = COUNTRIES.find(c=>c.code===code);
    Alert.alert(`Smazat ${country?.name}?`, 'Hospůdky z dané oblasti budou odebrány z offline úložiště.', [
      {text:'Zrušit',style:'cancel'},
      {text:'Smazat',style:'destructive', onPress: async () => {
        // TASK 5: Delete offline map pack
        if (MapboxNative?.offlineManager) {
          try { await MapboxNative.offlineManager.deletePack(`map_${code}`); } catch {}
        }
        const pubs = await getOfflinePubs();
        await saveOfflinePubs(pubs.filter(p=>p.country!==code));
        const newAreas = areas.filter(a=>a!==code);
        await saveOfflineAreas(newAreas);
        setAreas(newAreas);
        setPubCounts(c=>{ const n={...c}; delete n[code]; return n; });
        await AsyncStorage.removeItem(`version_${code}`);
        onAreaDownloaded?.();
      }},
    ]);
  };

  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <View style={[s.modalCard,{maxHeight:SH*0.72}]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Offline oblasti</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
          </View>
          <Text style={[s.dimText,{marginBottom:14}]}>Stáhni si oblast, abys mohl(a) hrát bez připojení. Stažené hospůdky se aktualizují opětovným stažením.</Text>
          <ScrollView showsVerticalScrollIndicator={false}>
            {COUNTRIES.map(c=>{
              const downloaded = areas.includes(c.code);
              const isDown     = downloading===c.code;
              const count      = pubCounts[c.code];
              const pct        = progress[`map_${c.code}`];
              const packReady  = !!packsReady[`map_${c.code}`];
              return (
                <View key={c.code} style={s.areaRow}>
                  <Text style={s.areaFlag}>{c.flag}</Text>
                  <View style={{flex:1}}>
                    <Text style={[s.areaName,downloaded&&{color:C.green}]}>{c.name}</Text>
                    {downloaded&&count!=null&&<Text style={s.dimText}>{count} hospůdek</Text>}
                    {downloaded && (
                      <Text style={[s.dimText,{marginTop:2}]}>
                        Mapa: {packReady ? 'stažena offline' : isDown ? 'stahuje se…' : 'čeká na dokončení'}
                      </Text>
                    )}
                    {pct > 0 && pct < 100 && (
                      <View style={{marginTop:4}}>
                        <View style={{height:6,backgroundColor:'#333',borderRadius:4,overflow:'hidden'}}>
                          <View style={{width:`${pct}%`,height:'100%',backgroundColor:C.amber}}/>
                        </View>
                        <Text style={{fontSize:10,color:'#aaa'}}>{Math.round(pct)} %</Text>
                      </View>
                    )}
                  </View>
                  {downloaded ? (
                    <View style={{flexDirection:'row',gap:8}}>
                      <TouchableOpacity style={s.areaDlBtn} onPress={()=>checkForUpdates(c.code)} disabled={!!downloading}>
                        <Ionicons name="refresh-outline" size={15} color={C.bg}/>
                      </TouchableOpacity>
                      <TouchableOpacity style={[s.areaDlBtn,{backgroundColor:'#3A0000'}]} onPress={()=>remove(c.code)}>
                        <Ionicons name="trash-outline" size={15} color={C.red}/>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <TouchableOpacity style={s.areaDlBtn} onPress={()=>download(c)} disabled={!!downloading}>
                      {isDown?<ActivityIndicator size="small" color={C.bg}/>:<>
                        <Ionicons name="download-outline" size={15} color={C.bg}/>
                        <Text style={s.areaDlT}>Stáhnout</Text>
                      </>}
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// NAVRHNOUT HOSPŮDKU MODAL
// ══════════════════════════════════════════════════════════════════════════════
const SuggestPubModal = ({ lat, lng, onClose }) => {
  const [name, setName]       = useState('');
  const [type, setType]       = useState('hospoda');
  const [address, setAddress] = useState('');
  const [note, setNote]       = useState('');
  const [busy, setBusy]       = useState(false);

  const submit = async() => {
    if (!name.trim()) { Alert.alert('Zadej název!'); return; }
    setBusy(true);
    try {
      await apiFetch('/pubs/suggest',{method:'POST',body:JSON.stringify({name,type,address,note,latitude:lat,longitude:lng})});
      Alert.alert('Díky!','Tvůj návrh byl odeslán ke kontrole. Pokud bude schválen, hospůdka se objeví na mapě.');
      onClose();
    } catch(e) { Alert.alert('Chyba',e.message); }
    setBusy(false);
  };

  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{width:'100%'}}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Navrhnout hospůdku</Text>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={[s.dimText,{marginBottom:12}]}>📍 {lat?.toFixed(5)}, {lng?.toFixed(5)}</Text>
              <TextInput style={s.input} placeholder="Název podniku *" placeholderTextColor={C.creamDim} value={name} onChangeText={setName}/>
              <Text style={s.secLabel}>Typ podniku</Text>
              <View style={{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:14}}>
                {PUB_TYPES.map(t=>(
                  <TouchableOpacity key={t} style={[s.fChip,type===t&&s.fChipOn]} onPress={()=>setType(t)}>
                    <Text style={[s.fChipT,type===t&&s.fChipTOn]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput style={s.input} placeholder="Adresa (volitelné)" placeholderTextColor={C.creamDim} value={address} onChangeText={setAddress}/>
              <TextInput style={[s.input,{minHeight:60,textAlignVertical:'top'}]} placeholder="Poznámka (volitelné)" placeholderTextColor={C.creamDim} value={note} onChangeText={setNote} multiline/>
              <TouchableOpacity style={[s.btnPri,{marginTop:4}]} onPress={submit} disabled={busy}>
                {busy?<ActivityIndicator color={C.bg}/>:<><Ionicons name="send-outline" size={18} color={C.bg}/><Text style={s.btnPriT}>Odeslat návrh</Text></>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// NAHLÁSIT CHYBU MODAL
// ══════════════════════════════════════════════════════════════════════════════
const REPORT_REASONS = ['Podnik neexistuje','Chybné informace','Chybná poloha na mapě','Podnik je trvale zavřen','Jiné'];

const ReportPubModal = ({ pub, onClose }) => {
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  const [busy, setBusy]     = useState(false);

  const submit = async() => {
    if (!reason) { Alert.alert('Vyber důvod!'); return; }
    setBusy(true);
    try {
      await apiFetch(`/pubs/${pub.id}/report`,{method:'POST',body:JSON.stringify({reason,detail})});
      Alert.alert('Nahlášeno','Chyba byla odeslána a bude co nejdříve opravena. Díky!');
      onClose();
    } catch(e) { Alert.alert('Chyba',e.message); }
    setBusy(false);
  };

  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{width:'100%'}}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Nahlásit chybu</Text>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
            </View>
            <Text style={[s.dimText,{marginBottom:14}]}>{pub.name}</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={s.secLabel}>Důvod</Text>
              {REPORT_REASONS.map(r=>(
                <TouchableOpacity key={r} style={[s.ansBtn,reason===r&&s.ansBtnOn]} onPress={()=>setReason(r)}>
                  <Ionicons name={reason===r?'radio-button-on':'radio-button-off'} size={16} color={reason===r?C.amber:C.creamDim}/>
                  <Text style={[s.ansT,reason===r&&{color:C.cream}]}>{r}</Text>
                </TouchableOpacity>
              ))}
              <Text style={[s.secLabel,{marginTop:10}]}>Popis (volitelné)</Text>
              <TextInput style={[s.input,{minHeight:70,textAlignVertical:'top'}]} placeholder="Popiš problém podrobněji…" placeholderTextColor={C.creamDim} value={detail} onChangeText={setDetail} multiline/>
              <TouchableOpacity style={[s.btnPri,{marginTop:4}]} onPress={submit} disabled={busy}>
                {busy?<ActivityIndicator color={C.bg}/>:<><Ionicons name="flag-outline" size={18} color={C.bg}/><Text style={s.btnPriT}>Odeslat nahlášení</Text></>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// ROUTING MODAL (GraphHopper)
// ══════════════════════════════════════════════════════════════════════════════
const RoutingModal = ({ pubs, userLoc, onRouteReady, onClose }) => {
  const [waypoints, setWaypoints] = useState([
    userLoc ? { label:'Moje poloha', lat:userLoc.latitude, lng:userLoc.longitude } : null,
    null
  ]);
  const [profile, setProfile]   = useState('walk');
  const [avoidMotorway, setAvoidMotorway] = useState(false);
  const [calculating, setCalc]  = useState(false);
  const [routeInfo, setRouteInfo] = useState(null);
  const [pubPicker, setPubPicker] = useState(null); // index of waypoint being set from pub
  const [pubPickerQ, setPubPickerQ] = useState(''); // search query in pub picker
  const [pubPickerMode, setPubPickerMode] = useState('pubs'); // 'pubs' or 'stops'
  const [pubPickerStops, setPubPickerStops] = useState([]);
  const [loadingStops, setLoadingStops] = useState(false);
  useEffect(() => {
    let mounted = true;
    const loadStops = async () => {
      if (pubPicker === null || pubPickerMode !== 'stops') return;
      setLoadingStops(true);
      try {
        const centerLat = userLoc ? userLoc.latitude : INITIAL_MAP_CENTER[1];
        const centerLng = userLoc ? userLoc.longitude : INITIAL_MAP_CENTER[0];
        const res = await apiFetch(`/transport/nearby?lat=${centerLat}&lng=${centerLng}&radius=20000`);
        if (!mounted) return;
        setPubPickerStops(res.stops || []);
      } catch (e) {
        if (!mounted) return;
        setPubPickerStops([]);
      }
      setLoadingStops(false);
    };
    loadStops();
    return () => { mounted = false; };
  }, [pubPicker, pubPickerMode, userLoc]);

  const isValidCoord = value => Number.isFinite(Number(value));
  const setWp = (idx, wp) => setWaypoints(prev => {
    const n = [...prev];
    if (typeof idx === 'number' && idx >= 0 && idx < n.length) {
      n[idx] = wp;
    }
    return n;
  });
  const addWp = () => setWaypoints(prev => [...prev, null]);
  const removeWp = idx => setWaypoints(prev => prev.filter((_,i)=>i!==idx));
  const moveWpUp = idx => setWaypoints(prev => {
    if (idx <= 0) return prev;
    const n = [...prev];
    [n[idx-1], n[idx]] = [n[idx], n[idx-1]];
    return n;
  });
  const moveWpDown = idx => setWaypoints(prev => {
    if (idx >= prev.length-1) return prev;
    const n = [...prev];
    [n[idx], n[idx+1]] = [n[idx+1], n[idx]];
    return n;
  });
  const useMyLoc = idx => {
    if (!userLoc) { Alert.alert('Bez GPS','Poloha není dostupná.'); return; }
    setWp(idx, { label:'Moje poloha', lat:userLoc.latitude, lng:userLoc.longitude });
  };

  const calculate = async () => {
    const filled = waypoints.filter(Boolean);
    if (filled.length < 2) { Alert.alert('Chybí body','Zvol alespoň start a cíl.'); return; }
    setCalc(true);
    try {
      let ghProfile = TRANSPORT_MODES.find(m=>m.id===profile)?.gh || 'foot';
      if (profile === 'car' && avoidMotorway) ghProfile = 'car_avoid_motorway';
      const result = await fetchGHRoute(filled, ghProfile);
      setRouteInfo(result);
      onRouteReady(result);
    } catch(e) { Alert.alert('Chyba trasování', e.message); }
    setCalc(false);
  };

  const clearRoute = () => { setRouteInfo(null); onRouteReady(null); };

  const GH_PROFILES = TRANSPORT_MODES;

  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <View style={[s.modalCard,{maxHeight:SH*0.82}]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Naplánovat trasu</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {/* Waypoints */}
            {waypoints.map((wp, idx) => (
              <View key={idx} style={{flexDirection:'row',alignItems:'center',gap:6,marginBottom:10}}>
                {/* Reorder arrows */}
                <View style={{gap:2}}>
                  <TouchableOpacity
                    onPress={()=>moveWpUp(idx)}
                    disabled={idx===0}
                    style={{padding:3,opacity:idx===0?0.2:1}}
                  >
                    <Ionicons name="chevron-up" size={14} color={C.creamDim}/>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={()=>moveWpDown(idx)}
                    disabled={idx===waypoints.length-1}
                    style={{padding:3,opacity:idx===waypoints.length-1?0.2:1}}
                  >
                    <Ionicons name="chevron-down" size={14} color={C.creamDim}/>
                  </TouchableOpacity>
                </View>
                <View style={{width:24,height:24,borderRadius:12,backgroundColor:idx===0?C.teal:idx===waypoints.length-1?C.amber:C.purple,alignItems:'center',justifyContent:'center'}}>
                  <Text style={{color:C.bg,fontWeight:'900',fontSize:10}}>{idx===0?'A':idx===waypoints.length-1?'B':String.fromCharCode(65+idx)}</Text>
                </View>
                <TouchableOpacity style={[s.input,{flex:1,marginBottom:0,minHeight:42,justifyContent:'center'}]}
                  onPress={()=>setPubPicker(idx)}>
                  <Text style={{color:wp?C.cream:C.creamDim,fontSize:14}} numberOfLines={1}>
                    {wp ? wp.label : 'Vybrat hospůdku…'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity onPress={()=>useMyLoc(idx)} style={{padding:8,backgroundColor:C.bgCardAlt,borderRadius:10,borderWidth:1,borderColor:C.border}}>
                  <Ionicons name="locate-outline" size={18} color={C.teal}/>
                </TouchableOpacity>
                {waypoints.length>2&&idx>0&&idx<waypoints.length-1 && (
                  <TouchableOpacity onPress={()=>removeWp(idx)}>
                    <Ionicons name="close-circle" size={20} color={C.red}/>
                  </TouchableOpacity>
                )}
              </View>
            ))}
            <TouchableOpacity style={[s.btnSec,{marginBottom:12,flexDirection:'row',gap:6,justifyContent:'center'}]} onPress={addWp}>
              <Ionicons name="add-circle-outline" size={18} color={C.amber}/>
              <Text style={{color:C.amber,fontWeight:'700'}}>Přidat zastávku</Text>
            </TouchableOpacity>

            {/* Profil (způsob dopravy) */}
            <Text style={s.secLabel}>Způsob dopravy</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:profile==='car'?8:14}}>
              {GH_PROFILES.map(m=>(
                <TouchableOpacity key={m.id} style={{alignItems:'center',marginRight:14}} onPress={()=>setProfile(m.id)}>
                  <View style={{width:50,height:50,borderRadius:25,alignItems:'center',justifyContent:'center',
                    backgroundColor:profile===m.id?C.amber:C.bgCardAlt,
                    borderWidth:2,borderColor:profile===m.id?C.amber:C.border}}>
                    <Ionicons name={m.icon} size={22} color={profile===m.id?C.bg:C.creamDim}/>
                  </View>
                  <Text style={{color:profile===m.id?C.amber:C.creamDim,fontSize:11,marginTop:4,fontWeight:profile===m.id?'700':'400'}}>{m.label}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            {profile==='car' && (
              <TouchableOpacity
                style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:10,paddingHorizontal:12,backgroundColor:C.bgCardAlt,borderRadius:12,borderWidth:1,borderColor:avoidMotorway?C.amber:C.border,marginBottom:14}}
                onPress={()=>setAvoidMotorway(v=>!v)}
              >
                <Ionicons name={avoidMotorway?'checkbox':'square-outline'} size={20} color={avoidMotorway?C.amber:C.creamDim}/>
                <Text style={{color:avoidMotorway?C.cream:C.creamDim,fontWeight:'600',fontSize:14,flex:1}}>Vyvarovat se dálnicím</Text>
                <Ionicons name="car-outline" size={16} color={C.creamDim}/>
              </TouchableOpacity>
            )}

            {/* Route info */}
            {routeInfo && (
              <View style={{backgroundColor:C.bgCardAlt,borderRadius:14,padding:12,marginBottom:12,borderWidth:1,borderColor:C.teal,flexDirection:'row',gap:16,alignItems:'center'}}>
                <View style={{flex:1}}>
                  <Text style={{color:C.teal,fontWeight:'800',fontSize:15}}>{routeInfo.distance>=1000?`${(routeInfo.distance/1000).toFixed(1)} km`:`${Math.round(routeInfo.distance)} m`}</Text>
                  <Text style={s.dimText}>≈ {routeInfo.duration} min</Text>
                </View>
                <TouchableOpacity onPress={clearRoute}>
                  <Ionicons name="close-circle-outline" size={22} color={C.red}/>
                </TouchableOpacity>
              </View>
            )}

            <View style={{flexDirection:'row',gap:8}}>
              {routeInfo && (
                <TouchableOpacity style={[s.btnSec,{flex:1,justifyContent:'center'}]} onPress={clearRoute}>
                  <Text style={{color:C.creamDim,textAlign:'center',fontWeight:'600'}}>Smazat trasu</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={[s.btnPri,{flex:1}]} onPress={calculate} disabled={calculating}>
                {calculating
                  ? <ActivityIndicator color={C.bg}/>
                  : <><Ionicons name="navigate-outline" size={18} color={C.bg}/><Text style={s.btnPriT}>Naplánovat</Text></>
                }
              </TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>

      {/* Pub picker */}
      {pubPicker!==null && (
        <Modal visible animationType="slide" transparent>
          <View style={s.modalOverlay}>
            <View style={[s.modalCard,{maxHeight:SH*0.75}]}>
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Vybrat hospůdku</Text>
                <TouchableOpacity onPress={()=>{ setPubPicker(null); setPubPickerQ(''); }}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
              </View>
                <View style={{flexDirection:'row',gap:8,marginBottom:10}}>
                  <TouchableOpacity style={[s.ansBtn,pubPickerMode==='pubs'&&s.ansBtnOn]} onPress={()=>setPubPickerMode('pubs')}>
                    <Text style={[s.ansT,pubPickerMode==='pubs'&&{color:C.cream}]}>Podniky</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[s.ansBtn,pubPickerMode==='stops'&&s.ansBtnOn]} onPress={async ()=>{ setPubPickerMode('stops'); }}>
                    <Text style={[s.ansT,pubPickerMode==='stops'&&{color:C.cream}]}>Zastávky</Text>
                  </TouchableOpacity>
                </View>
                <TextInput
                style={[s.input,{marginBottom:10}]}
                placeholder="Hledat podle názvu…"
                placeholderTextColor={C.creamDim}
                value={pubPickerQ}
                onChangeText={setPubPickerQ}
                autoFocus
                autoCorrect={false}
                clearButtonMode="while-editing"
              />
                <FlatList
                  keyExtractor={(item, index) => String(item.id ?? item.name ?? `${item.latitude}_${item.longitude}_${index}`)}
                  data={pubPickerMode === 'pubs'
                    ? pubs.filter(p => isValidCoord(p.latitude) && isValidCoord(p.longitude) && (pubPickerQ.trim().length < 2 || String(p.name || '').toLowerCase().includes(pubPickerQ.trim().toLowerCase())))
                    : pubPickerStops.filter(s => isValidCoord(s.latitude) && isValidCoord(s.longitude) && (pubPickerQ.trim().length < 2 || String(s.name || '').toLowerCase().includes(pubPickerQ.trim().toLowerCase())))
                  }
                
                keyboardShouldPersistTaps="handled"
                  renderItem={({item})=>{
                    if (pubPickerMode === 'pubs') {
                      return (
                        <TouchableOpacity style={[s.lbRow,{marginBottom:6}]}
                          onPress={()=>{
                            setWp(pubPicker, {
                              label: String(item.name || 'Vybraná hospůdka'),
                              lat: Number(item.latitude),
                              lng: Number(item.longitude),
                            });
                            setPubPicker(null);
                            setPubPickerQ('');
                          }}>
                          <Ionicons name={visited.has?.(item.id)?'checkmark-circle':'beer-outline'} size={18} color={visited.has?.(item.id)?C.green:C.amber} style={{marginRight:8}}/>
                          <View style={{flex:1}}>
                            <Text style={{color:C.cream,fontWeight:'700'}}>{item.name || 'Bez názvu'}</Text>
                            <Text style={s.dimText}>{[item.type,item.city].filter(Boolean).join(' · ')}</Text>
                          </View>
                        </TouchableOpacity>
                      );
                    }
                    // stops
                    return (
                      <TouchableOpacity style={[s.lbRow,{marginBottom:6}]}
                        onPress={()=>{
                          setWp(pubPicker, {
                            label: String(item.name || (item.stop_type || 'Zastávka')),
                            lat: Number(item.latitude),
                            lng: Number(item.longitude),
                          });
                          setPubPicker(null);
                          setPubPickerQ('');
                        }}>
                        <Ionicons name="train-outline" size={18} color={C.purple} style={{marginRight:8}}/>
                        <View style={{flex:1}}>
                          <Text style={{color:C.cream,fontWeight:'700'}}>{item.name || (item.stop_type || 'Zastávka')}</Text>
                          <Text style={s.dimText}>{item.stop_type ? item.stop_type : ''}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  }}
                contentContainerStyle={{padding:8,paddingBottom:20}}
                ListEmptyComponent={<Text style={{color:C.creamDim,textAlign:'center',padding:20}}>Žádný podnik nenalezen.</Text>}
              />
            </View>
          </View>
        </Modal>
      )}
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAP SCREEN – WebView + Mapbox GL JS
// ══════════════════════════════════════════════════════════════════════════════
const MapScreen = ({ user, deepLinkPubId, onDeepLinkHandled }) => {
  const cameraRef       = useRef(null);
  const shapeSourceRef  = useRef(null);
  const hasCenteredRef  = useRef(false);
  const suggestModeRef  = useRef(false);
  const watchRef        = useRef(null);

  const [pubs, setPubs]                 = useState([]);
  const [visited, setVisited]           = useState(new Set());
  const [loc, setLoc]                   = useState(null);
  const [loading, setLoading]           = useState(true);
  const [selPub, setSelPub]             = useState(null);
  const [showSheet, setShowSheet]       = useState(false);
  const [showInfo, setShowInfo]         = useState(false);
  const [logModal, setLogModal]         = useState(false);
  const [filterMod, setFilterMod]       = useState(false);
  const [offlineRegionsMod, setOffReg]  = useState(false);
  const [reportMod, setReportMod]       = useState(false);
  const [suggestMode, setSuggestMode]   = useState(false);
  const [suggestCoords, setSuggestCo]   = useState(null);
  const [suggestModal, setSuggestMod]   = useState(false);
  const [filters, setFilters]           = useState({...DEF_FILTERS});
  const [mockBlocked, setMockBlocked]   = useState(false);
  const [adminMockBanner, setAdminMockBanner] = useState(false);
  const [showAreaWarning, setShowAreaWarning] = useState(false);
  const [currentAreaName, setCurrentAreaName] = useState('');
  const [viewport, setViewport]         = useState({ center: INITIAL_MAP_CENTER, zoom: 9 });
  const [routeShape, setRouteShape]     = useState(null);
  const [routingMod, setRoutingMod]     = useState(false);
  const [searchMod, setSearchMod]       = useState(false);
  const [searchQ, setSearchQ]           = useState('');
  const [mapStyleId, setMapStyleId]     = useState(MAPBOX_STYLE_OPTIONS[0].id);
  const [stylePickerOpen, setStylePickerOpen] = useState(false);
  const [nearbyTransport, setNearbyTransport] = useState({ stops: [], parking: [] });
  const [transportLoading, setTransportLoading] = useState(false);
  const [selectedPoi, setSelectedPoi]   = useState(null);
  const slideAnim = useRef(new Animated.Value(300)).current;

  const activeMapStyleUrl = useMemo(() => {
    return MAPBOX_STYLE_OPTIONS.find(s => s.id === mapStyleId)?.url || MAPBOX_STYLE_URL;
  }, [mapStyleId]);

  const fCount = useMemo(()=>{
    let n=0;
    if(filters.visited!=='all')n++;
    if(filters.types?.length>0)n++;
    if(filters.card!=='any')n++;
    if(filters.minRating>0)n++;
    if(filters.beer?.trim())n++;
    return n;
  },[filters]);

  const updateAreaWarning = useCallback(async (lat, lng) => {
    const offlineAreas = await getOfflineAreas();
    let found = false;
    for (const code of offlineAreas) {
      const country = COUNTRIES.find(c => c.code === code);
      if (!country) continue;
      if (
        lat >= country.bounds.minLat &&
        lat <= country.bounds.maxLat &&
        lng >= country.bounds.minLng &&
        lng <= country.bounds.maxLng
      ) {
        found = true;
        break;
      }
    }
    setShowAreaWarning(!found);
    setCurrentAreaName(found ? '' : 'této oblasti');
  }, []);

  useEffect(() => {
    loadData();
    setupLoc();
    registerBackgroundFetch();

    // BONUS: Keep Mapbox informed of connectivity on all platforms
    if (MapboxNative) {
      NetInfo.fetch().then(state => MapboxNative.setConnected(state.isConnected ?? true));
      const unsubscribe = NetInfo.addEventListener(state => {
        MapboxNative.setConnected(state.isConnected ?? true);
      });
      return () => {
        watchRef.current?.remove?.();
        unsubscribe();
      };
    }

    return () => {
      watchRef.current?.remove?.();
    };
  }, [updateAreaWarning]);

  const loadData = async () => {
    try {
      // Load map viewport setting and saved position
      const settings = await apiFetch('/profile/settings').catch(() => ({}));
      const rememberMap = settings.map_remember_position !== false;
      if (rememberMap) {
        const savedViewport = await AsyncStorage.getItem('map_viewport');
        if (savedViewport) {
          const vp = JSON.parse(savedViewport);
          setViewport({ center: vp.center || INITIAL_MAP_CENTER, zoom: vp.zoom || 9 });
        }
      }

      const offPubs = await getOfflinePubs();
      const vd = await cached(`v_${user.id}`,()=>apiFetch('/visits/my'),TTL).catch(async()=>{
        const raw=await AsyncStorage.getItem(`c_v_${user.id}`);
        return raw?(JSON.parse(raw).data||[]):[];
      });
      if (offPubs.length === 0) {
        Alert.alert(
          'Nejsou žádné hospůdky',
          'Stáhni si oblast v offline správci (tlačítko 📥 na mapě), abys mohl(a) hrát.',
          [{text:'OK'}]
        );
      }
      setPubs(offPubs);
      setVisited(new Set(vd.map(v=>v.pub_id)));
      updateAreaWarning(viewport.center[1], viewport.center[0]);
    } catch(e){console.error(e);}
    finally{setLoading(false);}
  };

  // Save viewport when map moves
  const handleMapIdle = useCallback(async (state) => {
    const center = state?.properties?.center;
    const zoom = state?.properties?.zoom;
    if (!Array.isArray(center) || !Number.isFinite(zoom)) return;
    
    const settings = await apiFetch('/profile/settings').catch(() => ({}));
    if (settings.map_remember_position !== false) {
      const vp = { center, zoom };
      setViewport(vp);
      AsyncStorage.setItem('map_viewport', JSON.stringify(vp)).catch(() => {});
    }
    
    updateAreaWarning(center[1], center[0]);
  }, [updateAreaWarning]);

  const setupLoc = async () => {
    const {status} = await Location.requestForegroundPermissionsAsync();
    if(status !== 'granted') return;
    const l = await Location.getCurrentPositionAsync({accuracy: Location.Accuracy.High});
    if (l.mocked) {
      if (user.is_admin) {
        setAdminMockBanner(true);
      } else {
        setMockBlocked(true);
        return;
      }
    }
    setLoc(l.coords);
    watchRef.current = await Location.watchPositionAsync({accuracy:Location.Accuracy.High,distanceInterval:5}, ll => {
      if (ll.mocked && !user.is_admin) {
        setMockBlocked(true);
      } else {
        setLoc(ll.coords);
      }
    });
  };

  const filtered = useMemo(()=>pubs.filter(p=>{
    if(p.is_active === false) return false;
    if(filters.visited==='visited'  &&!visited.has(p.id))return false;
    if(filters.visited==='unvisited'&& visited.has(p.id))return false;
    if(filters.types?.length>0&&!filters.types.includes(p.type))return false;
    if(filters.card==='yes'&&!p.card_payment)return false;
    if(filters.card==='no'&&p.card_payment)return false;
    if(filters.minRating>0&&(p.avg_rating||0)<filters.minRating)return false;
    if(filters.beer?.trim()&&!p.beers?.toLowerCase().includes(filters.beer.toLowerCase()))return false;
    return true;
  }),[pubs,visited,filters]);

  const pubsShape = useMemo(() => ({
    type: 'FeatureCollection',
    features: filtered
      .filter(p => Number.isFinite(p.longitude) && Number.isFinite(p.latitude))
      .map(p => ({
        type: 'Feature',
        id: String(p.id),
        properties: { id: p.id, visited: visited.has(p.id) ? 1 : 0 },
        geometry: { type: 'Point', coordinates: [p.longitude, p.latitude] },
      })),
  }), [filtered, visited]);

  const selectedPubShape = useMemo(() => {
    if (!selPub) return null;
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: `selected-${selPub.id}`,
        properties: {},
        geometry: { type: 'Point', coordinates: [selPub.longitude, selPub.latitude] },
      }],
    };
  }, [selPub]);

  const transportShape = useMemo(() => toPoiFeatures(nearbyTransport?.stops || [], 'transport'), [nearbyTransport]);
  const parkingShape = useMemo(() => toPoiFeatures(nearbyTransport?.parking || [], 'parking'), [nearbyTransport]);

  useEffect(()=>{
    if(!loc||hasCenteredRef.current||!cameraRef.current)return;
    hasCenteredRef.current = true;
    cameraRef.current.setCamera({
      centerCoordinate: [loc.longitude, loc.latitude],
      zoomLevel: 14,
      animationDuration: 900,
      animationMode: 'flyTo',
    });
  },[loc]);

  // Live odpočet vzdálenosti – aktualizuje se každou sekundu, ne jen při pohybu
  const locRef = useRef(null);
  useEffect(() => { locRef.current = loc; }, [loc]);
  const selPubRef = useRef(null);
  useEffect(() => { selPubRef.current = selPub; }, [selPub]);
  const [selPubDist, setSelPubDist] = useState(null);
  useEffect(() => {
    const tick = () => {
      const l = locRef.current;
      const p = selPubRef.current;
      if (!l || !p) { setSelPubDist(null); return; }
      setSelPubDist(Math.round(hav(l.latitude, l.longitude, p.latitude, p.longitude)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [selPub]); // restart intervalu když se změní vybraná hospůdka

  const loadNearbyTransport = useCallback(async (pub) => {
    if (!pub?.latitude || !pub?.longitude) {
      setNearbyTransport({ stops: [], parking: [] });
      return;
    }
    setTransportLoading(true);
    try {
      const data = await apiFetch(`/transport/nearby?lat=${pub.latitude}&lng=${pub.longitude}&radius=1500`);
      setNearbyTransport(data || { stops: [], parking: [] });
    } catch {
      setNearbyTransport({ stops: [], parking: [] });
    } finally {
      setTransportLoading(false);
    }
  }, []);

  const openPub = useCallback(pub => {
    if (!cameraRef.current) return;
    setSelPub(pub);
    setSelectedPoi(null);
    setShowSheet(true);
    loadNearbyTransport(pub);
    cameraRef.current?.setCamera({
      centerCoordinate: [pub.longitude, pub.latitude],
      padding: { paddingTop: 80, paddingRight: 40, paddingBottom: 260, paddingLeft: 40 },
      animationDuration: 500,
      animationMode: 'easeTo',
    });
    Animated.spring(slideAnim,{toValue:0,useNativeDriver:true,tension:100}).start();
  }, [slideAnim, loadNearbyTransport]);

  // If app was opened via deep link with pub id, try to open that pub
  useEffect(()=>{
    if(!deepLinkPubId) return;
    const id = String(deepLinkPubId);
    const found = pubs.find(p => String(p.id) === id);
    if(found){
      openPub(found);
      onDeepLinkHandled && onDeepLinkHandled();
      return;
    }
    // try fetch from API (may require auth)
    (async()=>{
      try{
        const pub = await apiFetch(`/pubs/${id}`);
        if(pub){
          // if pubs list doesn't contain it, add temporarily
          setPubs(prev => prev.some(p=>String(p.id)===String(pub.id)) ? prev : [...prev, pub]);
          openPub(pub);
        } else {
          // fallback to web preview
          Linking.openURL(`${API.replace('/api','')}/pub/${id}`);
        }
      }catch(e){
        Linking.openURL(`${API.replace('/api','')}/pub/${id}`);
      }finally{
        onDeepLinkHandled && onDeepLinkHandled();
      }
    })();
  },[deepLinkPubId, pubs]);

  const handleSourcePress = useCallback(async event => {
    const feature = event.features?.[0];
    if (!feature) return;

    if (feature.properties?.cluster) {
      try {
        const zoom = await shapeSourceRef.current?.getClusterExpansionZoom(feature);
        const coords = feature.geometry?.coordinates;
        if (Array.isArray(coords)) {
          cameraRef.current?.setCamera({
            centerCoordinate: coords,
            zoomLevel: zoom,
            animationDuration: 450,
            animationMode: 'easeTo',
          });
        }
      } catch (error) {
        console.warn('Cluster zoom selhal.', error);
      }
      return;
    }

    const pub = pubs.find(p => String(p.id) === String(feature.properties?.id));
    if (pub) openPub(pub);
  }, [openPub, pubs]);

  const handleMapPress = useCallback(feature => {
    if (!suggestModeRef.current) return;
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords)) return;
    setSuggestCo({ lat: coords[1], lng: coords[0] });
    setSuggestMod(true);
    suggestModeRef.current = false;
    setSuggestMode(false);
  }, []);



  const closeSheet = ()=>{
    cameraRef.current?.setCamera({
      padding: { paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 },
      animationDuration: 200,
      animationMode: 'easeTo',
    });
    Animated.timing(slideAnim,{toValue:300,duration:200,useNativeDriver:true}).start(()=>{
      setShowSheet(false);
      setSelPub(null);
      setNearbyTransport({ stops: [], parking: [] });
      setSelectedPoi(null);
    });
  };

  if(loading) return <View style={s.center}><ActivityIndicator color={C.amber} size="large"/></View>;
  if(mockBlocked) return (
    <View style={s.mockOverlay}>
      <Ionicons name="warning" size={48} color={C.red} />
      <Text style={s.mockTitle}>Nepovolená poloha</Text>
      <Text style={s.mockText}>
        Používání falešné polohy je proti pravidlům hry.
        Vypněte prosím mockování polohy a restartujte aplikaci.
      </Text>
      <TouchableOpacity style={s.btnPri} onPress={() => {}}>
        <Text style={s.btnPriT}>Restartovat</Text>
      </TouchableOpacity>
    </View>
  );

  if (!MAPBOX_SDK || !MapboxMapView || !MapboxCamera || !MapboxShapeSource || !MapboxCircleLayer || !MapboxSymbolLayer) {
    return (
      <View style={[s.center,{padding:24}]}> 
        <View style={s.authCard}>
          <Text style={s.modalTitle}>Mapbox Native neni k dispozici</Text>
          <Text style={[s.dimText,{marginTop:10,lineHeight:19}]}>Aplikace uz nepouziva WebView. Pro mapu je potreba development build nebo EAS build s nativnim modulem @rnmapbox/maps.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={{flex:1}}>
      <MapboxMapView
        style={{flex:1}}
        key={mapStyleId}
        styleURL={activeMapStyleUrl}
        preferredFramesPerSecond={60}
        compassEnabled
        compassFadeWhenNorth
        scaleBarEnabled={false}
        onPress={handleMapPress}
        onMapIdle={handleMapIdle}
      >
        <MapboxCamera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: INITIAL_MAP_CENTER,
            zoomLevel: 9,
          }}
        />
        {!!loc && !!MapboxLocationPuck && (
          <MapboxLocationPuck
            puckBearing="heading"
            puckBearingEnabled
            pulsing={{ isEnabled: true, color: C.teal, radius: 'accuracy' }}
          />
        )}
        <MapboxShapeSource
          ref={shapeSourceRef}
          id={PUBS_SOURCE_ID}
          shape={pubsShape}
          cluster
          clusterRadius={42}
          clusterMaxZoomLevel={13}
          hitbox={{ width: 24, height: 24 }}
          onPress={handleSourcePress}
        >
          <MapboxCircleLayer
            id="pubs-clusters"
            filter={['has', 'point_count']}
            style={mapLayerStyles.clusterCircles}
          />
          <MapboxSymbolLayer
            id="pubs-cluster-counts"
            filter={['has', 'point_count']}
            style={mapLayerStyles.clusterLabels}
          />
          <MapboxCircleLayer
            id="pubs-points"
            filter={['!', ['has', 'point_count']]}
            style={mapLayerStyles.pubs}
          />
        </MapboxShapeSource>
      {selectedPubShape && (
        <MapboxShapeSource id={SELECTED_PUB_SOURCE_ID} shape={selectedPubShape}>
          <MapboxCircleLayer id="selected-pub-point" style={mapLayerStyles.selectedPub} />
        </MapboxShapeSource>
      )}
      {!!selPub && (
        <>
          <MapboxShapeSource
            id={TRANSPORT_SOURCE_ID}
            shape={transportShape}
            onPress={(event) => {
              const feature = event.features?.[0];
              if (feature?.properties) setSelectedPoi(feature.properties);
            }}
          >
            <MapboxCircleLayer id="transport-points" style={mapLayerStyles.transport} />
            <MapboxSymbolLayer id="transport-labels" style={mapLayerStyles.poiLabels} />
          </MapboxShapeSource>
          <MapboxShapeSource
            id={PARKING_SOURCE_ID}
            shape={parkingShape}
            onPress={(event) => {
              const feature = event.features?.[0];
              if (feature?.properties) setSelectedPoi(feature.properties);
            }}
          >
            <MapboxCircleLayer id="parking-points" style={mapLayerStyles.parking} />
            <MapboxSymbolLayer id="parking-labels" style={mapLayerStyles.poiLabels} />
          </MapboxShapeSource>
        </>
      )}
      {routeShape && MapboxLineLayer && (
          <MapboxShapeSource id="route-source" shape={routeShape}>
            <MapboxLineLayer id="route-line" style={{lineColor:C.teal,lineWidth:4,lineOpacity:0.9,lineCap:'round',lineJoin:'round'}}/>
          </MapboxShapeSource>
        )}
      </MapboxMapView>

      {/* HUD */}
      <View style={s.mapHud}>
        <View style={s.mapHudBox}>
          <Text style={s.mapHudN}>{visited.size}</Text>
          <Text style={s.mapHudL}>mých</Text>
        </View>
        <View style={[s.mapHudBox,{borderColor:fCount>0?C.amber:C.border}]}>
          <Text style={s.mapHudN}>{filtered.length}</Text>
          <Text style={s.mapHudL}>{fCount>0?'filtr':'celkem'}</Text>
        </View>
      </View>

      {/* Controls */}
      <View style={s.mapCtrl}>
        <TouchableOpacity style={s.mapBtn} onPress={()=>{
          if(!loc){Alert.alert('Poloha','Poloha není dostupná');return;}
          cameraRef.current?.setCamera({
            centerCoordinate: [loc.longitude, loc.latitude],
            zoomLevel: 14,
            animationDuration: 800,
            animationMode: 'flyTo',
          });
        }}>
          <Ionicons name="locate-outline" size={22} color={C.amber}/>
        </TouchableOpacity>
        <TouchableOpacity style={s.mapBtn} onPress={()=>setFilterMod(true)}>
          <Ionicons name="options-outline" size={22} color={fCount>0?C.amber:C.creamDim}/>
          {fCount>0&&<View style={s.fBadge}><Text style={s.fBadgeT}>{fCount}</Text></View>}
        </TouchableOpacity>
        <TouchableOpacity style={s.mapBtn} onPress={()=>setOffReg(true)}>
          <Ionicons name="download-outline" size={22} color={C.creamDim}/>
        </TouchableOpacity>
        <TouchableOpacity style={[s.mapBtn, mapStyleId!==MAPBOX_STYLE_OPTIONS[0].id && {borderColor:C.amber,borderWidth:2}]}
          onPress={()=>setStylePickerOpen(true)}>
          <Ionicons name="layers-outline" size={22} color={C.creamDim}/>
        </TouchableOpacity>
        <TouchableOpacity style={[s.mapBtn,suggestMode&&{borderColor:C.amber,borderWidth:2}]}
          onPress={()=>{
            const next=!suggestModeRef.current;
            suggestModeRef.current=next;
            setSuggestMode(next);
          }}>
          <Ionicons name="add-outline" size={24} color={suggestMode?C.amber:C.creamDim}/>
        </TouchableOpacity>
        <TouchableOpacity style={[s.mapBtn,routeShape&&{borderColor:C.teal,borderWidth:2}]} onPress={()=>setRoutingMod(true)}>
          <Ionicons name="navigate-outline" size={22} color={routeShape?C.teal:C.creamDim}/>
        </TouchableOpacity>
        <TouchableOpacity style={s.mapBtn} onPress={()=>{ setSearchQ(''); setSearchMod(true); }}>
          <Ionicons name="search-outline" size={22} color={C.creamDim}/>
        </TouchableOpacity>
      </View>

      {suggestMode&&(
        <View style={s.suggestHint}>
          <Ionicons name="location-outline" size={15} color={C.amber}/>
          <Text style={{color:C.amber,fontSize:12,fontWeight:'700',flex:1}}>Klepni na mapu pro umístění návrhu</Text>
          <TouchableOpacity onPress={()=>{suggestModeRef.current=false;setSuggestMode(false);}}>
            <Ionicons name="close-circle" size={16} color={C.creamDim}/>
          </TouchableOpacity>
        </View>
      )}

      {adminMockBanner && (
        <View style={s.mockAdminBanner}>
          <Ionicons name="bug-outline" size={16} color={C.bg}/>
          <Text style={s.mockAdminBannerT}>Mock poloha aktivní – testovací režim (admin)</Text>
          <TouchableOpacity onPress={()=>setAdminMockBanner(false)} hitSlop={{top:8,bottom:8,left:8,right:8}}>
            <Ionicons name="close" size={18} color={C.bg}/>
          </TouchableOpacity>
        </View>
      )}

      {showAreaWarning && (
        <View style={s.areaWarning}>
          <Ionicons name="cloud-offline-outline" size={16} color={C.amber} />
          <Text style={s.areaWarningText}>
            Nemáš staženou offline oblast pro {currentAreaName || 'tuto oblast'}. Stáhni ji v 📥 menu.
          </Text>
        </View>
      )}

      {stylePickerOpen && (
        <Modal visible animationType="fade" transparent onRequestClose={()=>setStylePickerOpen(false)}>
          <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'center',padding:20}}>
            <View style={[s.modalCard,{padding:16}]}> 
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Vybrat vrstvu mapy</Text>
                <TouchableOpacity onPress={()=>setStylePickerOpen(false)}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
              </View>
              {MAPBOX_STYLE_OPTIONS.map(option => (
                <TouchableOpacity
                  key={option.id}
                  style={[s.ansBtn, mapStyleId === option.id && s.ansBtnOn]}
                  onPress={() => {
                    setMapStyleId(option.id);
                    setStylePickerOpen(false);
                  }}
                >
                  <Text style={[s.ansT, mapStyleId === option.id && {color: C.cream}]}>{option.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </Modal>
      )}

      {/* Search modal */}
      {searchMod && (
        <Modal visible animationType="fade" transparent onRequestClose={()=>setSearchMod(false)}>
          <View style={{flex:1,backgroundColor:'rgba(0,0,0,0.6)',justifyContent:'flex-start',paddingTop:60}}>
            <View style={{backgroundColor:C.bgCard,marginHorizontal:16,borderRadius:20,padding:16,borderWidth:1,borderColor:C.border,maxHeight:SH*0.75}}>
              <View style={{flexDirection:'row',alignItems:'center',gap:10,marginBottom:12}}>
                <Ionicons name="search-outline" size={20} color={C.amber}/>
                <Text style={{color:C.amber,fontSize:17,fontWeight:'800',flex:1}}>Hledat podnik</Text>
                <TouchableOpacity onPress={()=>setSearchMod(false)}>
                  <Ionicons name="close" size={22} color={C.creamDim}/>
                </TouchableOpacity>
              </View>
              <TextInput
                style={[s.input,{marginBottom:10}]}
                placeholder="Název, adresa, typ…"
                placeholderTextColor={C.creamDim}
                value={searchQ}
                onChangeText={setSearchQ}
                autoFocus
                autoCorrect={false}
              />
              {(() => {
                const q = searchQ.trim().toLowerCase();
                const results = q.length < 2 ? [] : pubs.filter(p =>
                  (p.name||'').toLowerCase().includes(q) ||
                  (p.address||'').toLowerCase().includes(q) ||
                  (p.type||'').toLowerCase().includes(q) ||
                  (p.city||'').toLowerCase().includes(q)
                ).slice(0, 30);
                if (q.length > 0 && q.length < 2) return (
                  <Text style={{color:C.creamDim,textAlign:'center',padding:16}}>Zadej alespoň 2 znaky…</Text>
                );
                if (q.length >= 2 && results.length === 0) return (
                  <Text style={{color:C.creamDim,textAlign:'center',padding:16}}>Žádný podnik nenalezen.</Text>
                );
                return (
                  <FlatList
                    data={results}
                    keyExtractor={p=>String(p.id)}
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    renderItem={({item})=>(
                      <TouchableOpacity
                        style={{flexDirection:'row',alignItems:'center',gap:10,paddingVertical:12,borderBottomWidth:1,borderBottomColor:C.border}}
                        onPress={()=>{
                          setSearchMod(false);
                          setSearchQ('');
                          if(Number.isFinite(item.latitude)&&Number.isFinite(item.longitude)){
                            cameraRef.current?.setCamera({
                              centerCoordinate:[item.longitude,item.latitude],
                              zoomLevel:16,
                              animationDuration:800,
                              animationMode:'flyTo',
                            });
                          }
                          setSelPub(item);
                          setShowSheet(true);
                        }}
                      >
                        <View style={{width:36,height:36,borderRadius:18,backgroundColor:C.bgCardAlt,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:C.border}}>
                          <Ionicons name="beer-outline" size={18} color={C.amber}/>
                        </View>
                        <View style={{flex:1}}>
                          <Text style={{color:C.cream,fontWeight:'700',fontSize:14}} numberOfLines={1}>{item.name}</Text>
                          <Text style={{color:C.creamDim,fontSize:12}} numberOfLines={1}>{[item.type,item.address,item.city].filter(Boolean).join(' · ')}</Text>
                        </View>
                        {visited.has(item.id)&&<Ionicons name="checkmark-circle" size={18} color={C.green}/>}
                      </TouchableOpacity>
                    )}
                  />
                );
              })()}
            </View>
          </View>
        </Modal>
      )}

      {/* Bottom sheet */}
      {showSheet&&selPub&&(
        <Animated.View style={[s.pubSheet,{transform:[{translateY:slideAnim}]}]}>
          <View style={s.sheetHandle}/>
          <View style={{flexDirection:'row',alignItems:'flex-start',gap:10}}>
            <View style={{flex:1}}>
              <Text style={s.pubSheetName}>{selPub.name}</Text>
              <Text style={s.pubSheetType}>{selPub.type}</Text>
              {selPub.avg_rating>0&&(
                <View style={{flexDirection:'row',alignItems:'center',gap:6,marginTop:4}}>
                  <Stars rating={Math.round(selPub.avg_rating)} size={12}/>
                  <Text style={s.dimText}>({selPub.avg_rating?.toFixed(1)})</Text>
                </View>
              )}
            </View>
            <TouchableOpacity onPress={closeSheet} style={{padding:4}}>
              <Ionicons name="close" size={20} color={C.creamDim}/>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginVertical:8}}>
            {selPub.beers?.split(',').map(b=>b.trim()).filter(Boolean).map((b,i)=>(
              <Chip key={i} label={b} color={C.amber} icon="beer-outline"/>
            ))}
            {selPub.card_payment&&<Chip label="Karty" color={C.green} icon="card-outline"/>}
          </ScrollView>
          {selPub.opening_hours&&(
            <View style={{flexDirection:'row',alignItems:'center',gap:6,marginBottom:4}}>
              <Ionicons name="time-outline" size={13} color={C.creamDim}/>
              <Text style={s.dimText}>{selPub.opening_hours}</Text>
            </View>
          )}
          {transportLoading ? (
            <View style={{flexDirection:'row',alignItems:'center',gap:8,marginTop:6}}>
              <ActivityIndicator size="small" color={C.amber}/>
              <Text style={s.dimText}>Načítám dopravu a parkování v okolí…</Text>
            </View>
          ) : ((nearbyTransport?.stops?.length || 0) > 0 || (nearbyTransport?.parking?.length || 0) > 0) ? (
            <View style={s.transportSummary}>
              <View style={s.transportSummaryItem}>
                <Ionicons name="train-outline" size={15} color={C.purple}/>
                <Text style={s.transportSummaryText}>{nearbyTransport.stops.length} zastávek</Text>
              </View>
              <View style={s.transportSummaryItem}>
                <Ionicons name="car-outline" size={15} color={C.teal}/>
                <Text style={s.transportSummaryText}>{nearbyTransport.parking.length} parkovišť</Text>
              </View>
            </View>
          ) : null}
          <View style={{flexDirection:'row',gap:8,marginTop:10}}>
            {visited.has(selPub.id) ? (
              <View style={[s.btnOk,{flex:1}]}>
                <Ionicons name="checkmark-circle-outline" size={18} color={C.green}/>
                <Text style={[s.btnPriT,{color:C.green}]}>Odkliknuto</Text>
              </View>
            ) : selPubDist===null||selPubDist>25 ? (
              <View style={[s.btnDis,{flex:1}]}>
                <Ionicons name="walk-outline" size={17} color={C.creamDim}/>
                <Text style={s.btnDisT}>{selPubDist!==null?`${selPubDist} m do odkliku`:'Zapni GPS'}</Text>
              </View>
            ) : (
              <TouchableOpacity style={[s.btnPri,{flex:1}]} onPress={()=>setLogModal(true)}>
                <Ionicons name="checkmark-done-outline" size={18} color={C.bg}/>
                <Text style={s.btnPriT}>Odkliknout</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[s.btnSec,{paddingHorizontal:12}]}
              onPress={()=>{
                const lat=selPub.latitude, lng=selPub.longitude;
                const label=encodeURIComponent(selPub.name);
                const url=Platform.OS==='ios'
                  ? `maps://?q=${label}&ll=${lat},${lng}&dirflg=d`
                  : `geo:${lat},${lng}?q=${lat},${lng}(${label})`;
                Linking.canOpenURL(url).then(ok=>{
                  if(ok){ Linking.openURL(url); }
                  else {
                    // fallback to Google Maps in browser
                    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`);
                  }
                });
              }}
            >
              <Ionicons name="navigate" size={20} color={C.teal}/>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btnSec,{paddingHorizontal:12}]} onPress={()=>setReportMod(true)}>
              <Ionicons name="flag-outline" size={20} color={C.creamDim}/>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btnSec,{paddingHorizontal:12}]} onPress={()=>setShowInfo(true)}>
              <Ionicons name="information-circle-outline" size={22} color={C.amber}/>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {showInfo&&selPub&&<PubDetailModal pub={selPub} onClose={()=>setShowInfo(false)} userId={user.id} nearbyTransport={nearbyTransport} />}
      {reportMod&&selPub&&<ReportPubModal pub={selPub} onClose={()=>setReportMod(false)}/>}
      {logModal&&selPub&&(
        <LogModal pub={selPub} user={user} onClose={()=>setLogModal(false)}
          onSuccess={()=>{
            setVisited(p=>new Set([...p,selPub.id]));
            bust(`v_${user.id}`); setLogModal(false); closeSheet();
          }}/>
      )}
      {filterMod&&<FilterModal filters={filters} onApply={f=>setFilters(f)} onClose={()=>setFilterMod(false)}/>}
      {offlineRegionsMod&&<OfflineRegionsModal onClose={()=>setOffReg(false)} onAreaDownloaded={()=>{loadData(); updateAreaWarning(viewport.center[1], viewport.center[0]);}} userId={user.id} />}
      {suggestModal&&suggestCoords&&<SuggestPubModal lat={suggestCoords.lat} lng={suggestCoords.lng} onClose={()=>setSuggestMod(false)}/>}
      {selectedPoi && (
        <View style={s.poiToast}>
          <View style={[s.poiIconWrap,{backgroundColor:selectedPoi.kind === 'parking' ? 'rgba(22,160,133,0.18)' : normalizeStopType(selectedPoi.stop_type) === 'train' ? 'rgba(142,68,173,0.18)' : 'rgba(41,128,185,0.18)'}]}>
            <Ionicons
              name={selectedPoi.kind === 'parking' ? 'car-outline' : normalizeStopType(selectedPoi.stop_type) === 'train' ? 'train-outline' : 'bus-outline'}
              size={16}
              color={selectedPoi.kind === 'parking' ? C.teal : normalizeStopType(selectedPoi.stop_type) === 'train' ? C.purple : C.blue}
            />
          </View>
          <View style={{flex:1}}>
            <Text style={s.poiName}>{selectedPoi.name || (selectedPoi.kind === 'parking' ? 'Parkoviště' : 'Zastávka')}</Text>
            <Text style={s.dimText}>
              {selectedPoi.kind === 'parking'
                ? `${selectedPoi.distance_label || '—'}${selectedPoi.capacity ? ` · kapacita ${selectedPoi.capacity}` : ''}${selectedPoi.fee ? ' · placené' : ''}`
                : `${normalizeStopType(selectedPoi.stop_type) === 'train' ? 'Vlak / nádraží' : 'Bus / MHD'} · ${selectedPoi.distance_label || '—'}`}
            </Text>
          </View>
          <TouchableOpacity onPress={() => setSelectedPoi(null)}>
            <Ionicons name="close" size={18} color={C.creamDim}/>
          </TouchableOpacity>
        </View>
      )}

      {routingMod&&<RoutingModal pubs={pubs} userLoc={loc}
        onRouteReady={(result)=>{
          if (!result) { setRouteShape(null); return; }
          setRouteShape({ type:'Feature', geometry:{ type:'LineString', coordinates:result.coords } });
          if (result.coords.length > 1) {
            const lngs = result.coords.map(c=>c[0]);
            const lats = result.coords.map(c=>c[1]);
            cameraRef.current?.fitBounds(
              [Math.min(...lngs), Math.min(...lats)],
              [Math.max(...lngs), Math.max(...lats)],
              [80,80,80,80], 600
            );
          }
        }}
        onClose={()=>setRoutingMod(false)}/>}
    </View>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// LOG MODAL (with challenge unlock notifications)
// ══════════════════════════════════════════════════════════════════════════════
const LogModal = ({ pub, user, onClose, onSuccess }) => {
  const [step, setStep]         = useState('question');
  const [q, setQ]               = useState(null);
  const [ans, setAns]           = useState(null);
  const [rating, setRating]     = useState(0);
  const [note, setNote]         = useState('');
  const [noteViz, setNoteViz]   = useState('public');
  const [photos, setPhotos]     = useState([]);
  const [photosViz, setPhotosViz] = useState('public');
  const [transport, setTransport] = useState('walk');
  const [loading, setLoading]   = useState(true);
  const [busy, setBusy]         = useState(false);
  const [online, setOnline]     = useState(true);

  useEffect(()=>{
    apiFetch(`/pubs/${pub.id}/question`).then(setQ).catch(()=>setQ(null)).finally(()=>setLoading(false));
    NetInfo.fetch().then(s=>setOnline(s.isConnected));
  },[]);

  const pickPhoto = async()=>{
    const {status}=await ImagePicker.requestMediaLibraryPermissionsAsync();
    if(status!=='granted')return;
    const r=await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,quality:0.7});
    if(!r.canceled)setPhotos(p=>[...p,r.assets[0].uri]);
  };

  const submit = async()=>{
    if(q&&!ans){Alert.alert('Odpověz na otázku!');return;}
    if(rating===0){Alert.alert('Dej hodnocení!');return;}
    setBusy(true);
    const payload={pub_id:pub.id,answer_id:ans,rating,note,note_visibility:noteViz,photo_visibility:photosViz,travel_mode:transport,logged_at:new Date().toISOString()};
    try{
      let response;
      if(online){
        response = await apiFetch('/visits',{method:'POST',body:JSON.stringify(payload)});
        for(const uri of photos){
          const fd=new FormData();
          fd.append('photo',{uri,name:'photo.jpg',type:'image/jpeg'});
          fd.append('pub_id',String(pub.id));
          await fetch(`${API}/visits/photo`,{method:'POST',headers:{Authorization:`Bearer ${await getToken()}`},body:fd});
        }
      }else{
        await pushQ({type:'visit',payload,photos});
        Alert.alert('Offline','Odkliknutí uloženo lokálně.');
        onSuccess();
        return;
      }
      // Notifikace o nově splněných výzvách
      if (response.new_challenges && response.new_challenges.length) {
        for (const ch of response.new_challenges) {
          await scheduleLocalNotification('Výzva splněna!', `Získáváš výzvu: ${ch}`);
        }
      }
      onSuccess();
    }catch(e){Alert.alert('Chyba',e.message);}
    finally{setBusy(false);}
  };

  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{width:'100%'}}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{step==='question'?'Ověření':'Hodnocení'}</Text>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
            </View>
            <Text style={s.dimText}>{pub.name}</Text>
            {loading?<ActivityIndicator color={C.amber} style={{margin:20}}/>:(
              <ScrollView showsVerticalScrollIndicator={false}>
                {step==='question'&&q&&(
                  <View>
                    <Text style={s.qText}>{q.question_text}</Text>
                    {q.answers.map(a=>(
                      <TouchableOpacity key={a.id} style={[s.ansBtn,ans===a.id&&s.ansBtnOn]} onPress={()=>setAns(a.id)}>
                        <Ionicons name={ans===a.id?'radio-button-on':'radio-button-off'} size={16} color={ans===a.id?C.amber:C.creamDim}/>
                        <Text style={[s.ansT,ans===a.id&&{color:C.cream}]}>{a.answer_text}</Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity style={s.btnPri} onPress={()=>{if(!ans){Alert.alert('Vyber odpověď!');return;}setStep('rating');}}>
                      <Text style={s.btnPriT}>Pokračovat</Text>
                      <Ionicons name="arrow-forward" size={16} color={C.bg}/>
                    </TouchableOpacity>
                  </View>
                )}
                {(step==='rating'||!q)&&(
                  <View>
                    <Text style={s.secLabel}>Tvoje hodnocení</Text>
                    <View style={{flexDirection:'row',justifyContent:'center',marginVertical:16}}>
                      <Stars rating={rating} size={36} interactive onRate={setRating}/>
                    </View>
                    <Text style={s.secLabel}>Způsob dopravy</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom:14}}>
                      {TRANSPORT_MODES.map(m=>(
                        <TouchableOpacity key={m.id} style={{alignItems:'center',marginRight:14}} onPress={()=>setTransport(m.id)}>
                          <View style={{width:52,height:52,borderRadius:26,alignItems:'center',justifyContent:'center',
                            backgroundColor:transport===m.id?C.amber:C.bgCardAlt,
                            borderWidth:2,borderColor:transport===m.id?C.amber:C.border}}>
                            <Ionicons name={m.icon} size={24} color={transport===m.id?C.bg:C.creamDim}/>
                          </View>
                          <Text style={{color:transport===m.id?C.amber:C.creamDim,fontSize:11,marginTop:4,fontWeight:transport===m.id?'700':'400'}}>{m.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                    <Text style={s.secLabel}>Poznámka (volitelné)</Text>
                    <TextInput style={[s.input,{minHeight:70,textAlignVertical:'top'}]}
                      placeholder="Jak ses měl(a)?" placeholderTextColor={C.creamDim}
                      value={note} onChangeText={setNote} multiline/>
                    <View style={{flexDirection:'row',gap:8,marginBottom:14}}>
                      {[['public','👁 Veřejná'],['private','🔒 Soukromá']].map(([v,l])=>(
                        <TouchableOpacity key={v} style={[s.fChip,{flex:1,justifyContent:'center'},noteViz===v&&s.fChipOn]} onPress={()=>setNoteViz(v)}>
                          <Text style={[s.fChipT,noteViz===v&&s.fChipTOn]}>{l}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <Text style={s.secLabel}>Fotky (volitelné)</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {photos.map((uri,i)=>(
                        <View key={i} style={{marginRight:8,position:'relative'}}>
                          <Image source={{uri}} style={{width:70,height:70,borderRadius:8}}/>
                          <TouchableOpacity style={{position:'absolute',top:-6,right:-6}} onPress={()=>setPhotos(p=>p.filter((_,j)=>j!==i))}>
                            <Ionicons name="close-circle" size={18} color={C.red}/>
                          </TouchableOpacity>
                        </View>
                      ))}
                      <TouchableOpacity style={s.photoAdd} onPress={pickPhoto}>
                        <Ionicons name="camera-outline" size={24} color={C.amber}/>
                      </TouchableOpacity>
                    </ScrollView>
                    <View style={{flexDirection:'row',gap:8,marginTop:10,marginBottom:4}}>
                      {[['public','👁 Fotky veřejné'],['private','🔒 Fotky soukromé']].map(([v,l])=>(
                        <TouchableOpacity key={v} style={[s.fChip,{flex:1,justifyContent:'center'},photosViz===v&&s.fChipOn]} onPress={()=>setPhotosViz(v)}>
                          <Text style={[s.fChipT,photosViz===v&&s.fChipTOn]}>{l}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TouchableOpacity style={[s.btnPri,{marginTop:16}]} onPress={submit} disabled={busy}>
                      {busy?<ActivityIndicator color={C.bg}/>:<>
                        <Ionicons name="checkmark-done-outline" size={18} color={C.bg}/>
                        <Text style={s.btnPriT}>Potvrdit odkliknutí!</Text>
                      </>}
                    </TouchableOpacity>
                  </View>
                )}
              </ScrollView>
            )}
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// CHANGE PASSWORD MODAL
// ══════════════════════════════════════════════════════════════════════════════
const ChangePasswordModal = ({ onClose }) => {
  const [oldPw, setOldPw]     = useState('');
  const [newPw, setNewPw]     = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy]       = useState(false);

  const submit = async () => {
    if (!oldPw || !newPw || !confirm) { Alert.alert('Chybí údaje', 'Vyplň všechna pole.'); return; }
    if (newPw !== confirm) { Alert.alert('Hesla se neshodují'); return; }
    if (newPw.length < 6) { Alert.alert('Krátké heslo', 'Heslo musí mít alespoň 6 znaků.'); return; }
    setBusy(true);
    try {
      await apiFetch('/auth/change-password', { method: 'POST', body: JSON.stringify({ old_password: oldPw, new_password: newPw }) });
      Alert.alert('Hotovo ✓', 'Heslo bylo úspěšně změněno.');
      onClose();
    } catch(e) { Alert.alert('Chyba', e.message); }
    setBusy(false);
  };

  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{width:'100%'}}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Změnit heslo</Text>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
            </View>
            <TextInput style={s.input} placeholder="Současné heslo" placeholderTextColor={C.creamDim} value={oldPw} onChangeText={setOldPw} secureTextEntry/>
            <TextInput style={s.input} placeholder="Nové heslo" placeholderTextColor={C.creamDim} value={newPw} onChangeText={setNewPw} secureTextEntry/>
            <TextInput style={s.input} placeholder="Zopakuj nové heslo" placeholderTextColor={C.creamDim} value={confirm} onChangeText={setConfirm} secureTextEntry/>
            <TouchableOpacity style={s.btnPri} onPress={submit} disabled={busy}>
              {busy ? <ActivityIndicator color={C.bg}/> : <><Ionicons name="lock-closed-outline" size={18} color={C.bg}/><Text style={s.btnPriT}>Uložit nové heslo</Text></>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// AUTH SCREEN
// ══════════════════════════════════════════════════════════════════════════════
const AuthScreen = ({ onLogin }) => {
  const [mode, setMode]   = useState('login');
  const [email, setEmail] = useState('');
  const [pw, setPw]       = useState('');
  const [nick, setNick]   = useState('');
  const [busy, setBusy]   = useState(false);
  const [forgotMod, setForgotMod] = useState(false);
  const fa = useRef(new Animated.Value(0)).current;
  useEffect(()=>{ Animated.timing(fa,{toValue:1,duration:800,useNativeDriver:true}).start(); },[]);

  const submit = async()=>{
    if(!email||!pw||(mode==='register'&&!nick)){Alert.alert('Chybí údaje','Vyplň vše.');return;}
    setBusy(true);
    try{
      const body=mode==='login'?{email,password:pw}:{email,password:pw,username:nick};
      const data=await apiFetch(mode==='login'?'/auth/login':'/auth/register',{method:'POST',body:JSON.stringify(body)});
      await AsyncStorage.setItem('auth_token',data.token);
await AsyncStorage.setItem('user_data',JSON.stringify(data.user));
      await setupPushNotifications(data.user.id);
      onLogin(data.user);
    }catch(e){Alert.alert('Chyba',e.message);}
    finally{setBusy(false);}
  };

  const sendForgotPw = async (forgotEmail) => {
    if (!forgotEmail.trim()) { Alert.alert('Zadej e-mail'); return; }
    try {
      await apiFetch('/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email: forgotEmail }) });
      Alert.alert('Odesláno ✓', 'Zkontroluj svůj e-mail – pošleme ti odkaz pro reset hesla.');
    } catch(e) { Alert.alert('Chyba', e.message); }
  };

  return (
    <View style={{flex:1,backgroundColor:C.bg}}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg}/>
      <LinearGradient colors={[C.bg,'#1A0F00',C.bg]} style={{flex:1}}>
        <Animated.View style={{flex:1,alignItems:'center',justifyContent:'center',padding:24,opacity:fa}}>
          <Ionicons name="beer" size={72} color={C.amber} style={{marginBottom:8}}/>
          <Text style={s.authTitle}>Hospůdkobraní</Text>
          <Text style={s.authSub}>Sbírej hospůdky po celém Česku</Text>
          <View style={s.authCard}>
            <View style={s.authTabs}>
              {['login','register'].map(m=>(
                <TouchableOpacity key={m} style={[s.authTab,mode===m&&s.authTabOn]} onPress={()=>setMode(m)}>
                  <Text style={[s.authTabT,mode===m&&s.authTabTOn]}>{m==='login'?'Přihlášení':'Registrace'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {mode==='register'&&<TextInput style={s.input} placeholder="Přezdívka (nick)" placeholderTextColor={C.creamDim} value={nick} onChangeText={setNick} autoCapitalize="none"/>}
            <TextInput style={s.input} placeholder="E-mail" placeholderTextColor={C.creamDim} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"/>
            <TextInput style={s.input} placeholder="Heslo" placeholderTextColor={C.creamDim} value={pw} onChangeText={setPw} secureTextEntry/>
            <TouchableOpacity style={s.btnPri} onPress={submit} disabled={busy}>
              {busy?<ActivityIndicator color={C.bg}/>:<>
                <Ionicons name="log-in-outline" size={18} color={C.bg}/>
                <Text style={s.btnPriT}>{mode==='login'?'Vstoupit do hospody':'Zaregistrovat se'}</Text>
              </>}
            </TouchableOpacity>
            {mode==='login' && (
              <TouchableOpacity style={{alignItems:'center',marginTop:12}} onPress={()=>setForgotMod(true)}>
                <Text style={{color:C.amber,fontSize:13,textDecorationLine:'underline'}}>Zapomenuté heslo?</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={s.authFooter}>Pij s rozumem, sbírej bez hranic</Text>
        </Animated.View>
      </LinearGradient>
      {forgotMod && <ForgotPasswordModal onClose={()=>setForgotMod(false)} onSend={sendForgotPw}/>}
    </View>
  );
};

const ForgotPasswordModal = ({ onClose, onSend }) => {
  const [email, setEmail] = useState('');
  const [busy, setBusy]   = useState(false);
  const submit = async () => {
    setBusy(true);
    await onSend(email);
    setBusy(false);
    onClose();
  };
  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'} style={{width:'100%'}}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Zapomenuté heslo</Text>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
            </View>
            <Text style={[s.dimText,{marginBottom:14}]}>Zadej svůj e-mail a pošleme ti odkaz pro reset hesla.</Text>
            <TextInput style={s.input} placeholder="E-mail" placeholderTextColor={C.creamDim} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none"/>
            <TouchableOpacity style={s.btnPri} onPress={submit} disabled={busy}>
              {busy?<ActivityIndicator color={C.bg}/>:<><Ionicons name="mail-outline" size={18} color={C.bg}/><Text style={s.btnPriT}>Odeslat reset</Text></>}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// VISITS SCREEN
// ══════════════════════════════════════════════════════════════════════════════
const VisitsScreen = ({ user }) => {
  const [visits, setVisits]     = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefr]   = useState(false);
  const [sort, setSort]         = useState('date');
  const [detailPub, setDetail]  = useState(null);
  const [detailLoad, setDL]     = useState(false);

  useEffect(()=>{ load(); },[]);

  const load = async(force=false)=>{
    if(force) bust(`vd_${user.id}`);
    try{ const d=await cached(`vd_${user.id}`,()=>apiFetch('/visits/my?detail=1'),TTL); setVisits(d); }
    catch{}
    setLoading(false); setRefr(false);
  };

  const openDetail = async item=>{
    setDL(true);
    try{
      const p=await cached(`pub_${item.pub_id}`,()=>apiFetch(`/pubs/${item.pub_id}`),10*60*1000);
      setDetail(p);
    }catch{
      setDetail({id:item.pub_id,name:item.pub_name,type:item.pub_type,avg_rating:0,visit_count:0,card_payment:false,address:null,opening_hours:null,beers:null,note:null});
    }finally{setDL(false);}
  };

  const sorted = useMemo(()=>{
    const v=[...visits];
    if(sort==='date')  return v.sort((a,b)=>new Date(b.logged_at)-new Date(a.logged_at));
    if(sort==='rating')return v.sort((a,b)=>b.rating-a.rating);
    if(sort==='name')  return v.sort((a,b)=>a.pub_name.localeCompare(b.pub_name));
    return v;
  },[visits,sort]);

  const renderItem = ({item})=>(
    <TouchableOpacity style={s.visitCard} onPress={()=>openDetail(item)} activeOpacity={0.75}>
      <View style={{flexDirection:'row',alignItems:'flex-start',gap:10}}>
        {item.pub_photo_url
          ? <Image source={{uri:item.pub_photo_url}} style={{width:44,height:44,borderRadius:12}} resizeMode="cover"/>
          : <View style={s.visitIcon}><Ionicons name="beer-outline" size={22} color={C.amber}/></View>
        }
        <View style={{flex:1}}>
          <Text style={s.visitName}>{item.pub_name}</Text>
          <Text style={s.visitType}>{item.pub_type}</Text>
          <Stars rating={item.rating} size={13}/>
        </View>
        <View style={{alignItems:'flex-end',gap:4}}>
          <Text style={s.dimText}>{new Date(item.logged_at).toLocaleDateString('cs-CZ')}</Text>
          <Text style={[s.dimText,{fontSize:11}]}>{new Date(item.logged_at).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})}</Text>
          <Ionicons name="information-circle-outline" size={17} color={C.amber}/>
        </View>
      </View>
      {item.note?<Text style={s.visitNote}>"{item.note}"</Text>:null}
      {item.is_firstlast&&(
        <View style={{flexDirection:'row',alignItems:'center',gap:4,marginTop:6}}>
          <Ionicons name="ribbon-outline" size={14} color={C.purple}/>
          <Text style={{color:C.purple,fontSize:12,fontWeight:'700'}}>Prvochlast {item.firstlast_year}!</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  if(loading)return <View style={s.center}><ActivityIndicator color={C.amber} size="large"/></View>;
  return(
    <View style={s.screen}>
      <View style={s.pageHdr}>
        <Text style={s.pageTitle}>Moje hospůdky</Text>
        <Text style={s.pageSub}>{visits.length} navštívených</Text>
      </View>
      <View style={s.sortBar}>
        {[['date','Datum'],['rating','Hodnocení'],['name','Název']].map(([k,l])=>(
          <TouchableOpacity key={k} style={[s.sortBtn,sort===k&&s.sortBtnOn]} onPress={()=>setSort(k)}>
            <Text style={[s.sortBtnT,sort===k&&s.sortBtnTOn]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {visits.length>0&&(
        <View style={s.statsRow}>
          {[
            [(visits.reduce((a,v)=>a+v.rating,0)/visits.length).toFixed(1),'prům. hod.'],
            [Math.max(...visits.map(v=>v.rating)),'nejlepší'],
            [visits.filter(v=>v.rating>=4).length,'oblíbených'],
          ].map(([v,l],i)=>(
            <View key={i} style={s.statBox}><Text style={s.statNum}>{v}</Text><Text style={s.statLabel}>{l}</Text></View>
          ))}
        </View>
      )}
      <FlatList data={sorted} keyExtractor={i=>String(i.id)} renderItem={renderItem}
        contentContainerStyle={{padding:16,paddingBottom:100}}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.amber} colors={[C.amber]}
          onRefresh={()=>{setRefr(true);load(true);}}/>}
        ListEmptyComponent={<View style={s.empty}><Ionicons name="beer-outline" size={60} color={C.border}/><Text style={s.emptyT}>Zatím žádné návštěvy</Text><Text style={s.emptySub}>Jdi na mapu a odklikni svoji první!</Text></View>}
      />
      {detailLoad&&<View style={[StyleSheet.absoluteFill,{backgroundColor:'rgba(0,0,0,0.45)',alignItems:'center',justifyContent:'center'}]}><ActivityIndicator color={C.amber} size="large"/></View>}
      {detailPub&&<PubDetailModal pub={detailPub} onClose={()=>setDetail(null)} userId={user.id} />}
    </View>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// CHALLENGES SCREEN
// ══════════════════════════════════════════════════════════════════════════════
const ChallengesScreen = ({ user }) => {
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading]       = useState(true);
  useEffect(()=>{ load(); },[]);
  const load = async()=>{
    try{ const d=await cached(`ch_${user.id}`,()=>apiFetch('/challenges/my'),2*60*1000); setChallenges(d); }
    catch{}
    setLoading(false);
  };
  const renderItem = ({item})=>{
    const displayProgress = Math.min(item.progress, item.target);
    const pct=displayProgress/item.target, done=pct>=1;
    return(
      <View style={[s.chCard,done&&{borderColor:C.green}]}>
        <View style={{flexDirection:'row',alignItems:'flex-start',gap:10,marginBottom:10}}>
          <View style={[s.chIconBox,{backgroundColor:done?'rgba(39,174,96,0.15)':'rgba(245,166,35,0.1)'}]}>
            <Ionicons name={item.icon_name||'trophy-outline'} size={24} color={done?C.green:C.amber}/>
          </View>
          <View style={{flex:1}}>
            <Text style={s.chName}>{item.name}</Text>
            <Text style={s.chDesc}>{item.description}</Text>
          </View>
          {done&&<Ionicons name="checkmark-circle" size={22} color={C.green}/>}
        </View>
        <View style={s.progTrack}><View style={[s.progBar,{width:`${pct*100}%`,backgroundColor:done?C.green:C.amber}]}/></View>
        <Text style={s.dimText}>{displayProgress} / {item.target}{item.reward?` · ${item.reward}`:''}</Text>
      </View>
    );
  };
  if(loading)return <View style={s.center}><ActivityIndicator color={C.amber} size="large"/></View>;
  const done=challenges.filter(c=>c.progress>=c.target).length;
  return(
    <View style={s.screen}>
      <View style={s.pageHdr}>
        <Text style={s.pageTitle}>Výzvy</Text>
        <Text style={s.pageSub}>{done}/{challenges.length} splněno</Text>
      </View>
      <FlatList data={challenges} keyExtractor={i=>String(i.id)} renderItem={renderItem}
        contentContainerStyle={{padding:16,paddingBottom:100}}
        ListEmptyComponent={<View style={s.empty}><Ionicons name="trophy-outline" size={60} color={C.border}/><Text style={s.emptyT}>Žádné výzvy</Text></View>}
      />
    </View>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// COMMUNITY SCREEN (tabbed: žebříček, chaty, hledání, galerie)
// ══════════════════════════════════════════════════════════════════════════════

// Leaderboard sub-tab
const LeaderboardTab = ({ user }) => {
  const [board, setBoard]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefr] = useState(false);
  const [mode, setMode]       = useState('visits');
  const [userModal, setUM]    = useState(null);
  useEffect(()=>{ setLoading(true); load(); },[mode]);
  const load = async(force=false)=>{
    const k=`lb_${mode}`; if(force)bust(k);
    try{ const d=await cached(k,()=>apiFetch(`/leaderboard?mode=${mode}`),3*60*1000); setBoard(d); }
    catch{}
    setLoading(false); setRefr(false);
  };
  const MEDALS=['🥇','🥈','🥉'];
  const renderItem=({item,index})=>{
    const isMe=item.user_id===user.id;
    return(
      <TouchableOpacity style={[s.lbRow,isMe&&s.lbRowMe]} onPress={()=>setUM(item.username)} activeOpacity={0.75}>
        <Text style={s.lbRank}>{index<3?MEDALS[index]:`${index+1}.`}</Text>
        <Avatar url={item.avatar_url} size={40}/>
        <View style={{flex:1,marginLeft:10}}>
          <Text style={[s.lbName,isMe&&{color:C.amber}]}>{item.username}{isMe?' (já)':''}</Text>
          <Text style={s.dimText}>
            {mode==='visits'&&`${item.value} hospůdek`}
            {mode==='rating'&&`průměr ⭐ ${Number(item.value).toFixed(1)}`}
            {mode==='monthly'&&`${item.value} tento měsíc`}
          </Text>
        </View>
        <Text style={[s.lbVal,isMe&&{color:C.amber}]}>{mode==='rating'?Number(item.value).toFixed(1):item.value}</Text>
        <Ionicons name="chevron-forward" size={16} color={C.border} style={{marginLeft:4}}/>
      </TouchableOpacity>
    );
  };
  return(
    <View style={{flex:1}}>
      <View style={s.sortBar}>
        {[['visits','Hospůdky'],['rating','Hodnocení'],['monthly','Měsíc']].map(([k,l])=>(
          <TouchableOpacity key={k} style={[s.sortBtn,mode===k&&s.sortBtnOn]} onPress={()=>setMode(k)}>
            <Text style={[s.sortBtnT,mode===k&&s.sortBtnTOn]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {loading?<View style={s.center}><ActivityIndicator color={C.amber}/></View>:(
        <FlatList data={board} keyExtractor={i=>String(i.user_id)} renderItem={renderItem}
          contentContainerStyle={{padding:16,paddingBottom:20}}
          refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.amber} colors={[C.amber]}
            onRefresh={()=>{setRefr(true);load(true);}}/>}
          ListEmptyComponent={<View style={s.empty}><Ionicons name="trophy-outline" size={60} color={C.border}/><Text style={s.emptyT}>Žádná data</Text></View>}
        />
      )}
      {userModal&&<UserProfileModal username={userModal} selfId={user.id} onClose={()=>setUM(null)}/>}
    </View>
  );
};

// Chat sub-tab (socket-based, reactions, reply, read receipts)
const io = require('socket.io-client');
const ChatTab = ({ user }) => {
  const [msgs, setMsgs]       = useState([]);
  const [text, setText]       = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [userModal, setUserModal] = useState(null);
  const [replyTo, setReplyTo] = useState(null);
  const [reactModalFor, setReactModalFor] = useState(null);
  const listRef = useRef(null);
  const socketRef = useRef(null);

  useEffect(()=>{
    let mounted = true;
    const init = async()=>{
      await loadMsgs();
      // connect socket
      try{
        const token = await AsyncStorage.getItem('token');
        const base = API.replace('/api','');
        socketRef.current = io(base, { transports:['websocket'], auth: { token } });
        socketRef.current.on('connect', ()=>console.log('socket connected'));
        socketRef.current.on('disconnect', ()=>console.log('socket disconnected'));
        socketRef.current.on('chat:new', (m)=>{
          setMsgs(prev=>{
            const exists = prev.find(p=>p.id===m.id);
            if(exists) return prev;
            const merged = [...prev, m].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
            return merged;
          });
          // auto-scroll when new message arrives
          setTimeout(()=>listRef.current?.scrollToEnd({animated:true}), 80);
        });
        socketRef.current.on('chat:react', (d)=>{
          setMsgs(prev=>prev.map(m=>m.id===d.id?{...m, reactions: JSON.stringify(d.raw)}:m));
        });
        socketRef.current.on('chat:delete', (d)=>{
          setMsgs(prev=>prev.filter(m=>m.id!==d.id));
        });
        socketRef.current.on('chat:read', (d)=>{
          // optional: mark read status locally
        });
      }catch(e){console.warn('Socket init failed',e)}
    };
    init();
    return ()=>{ mounted=false; try{ socketRef.current?.disconnect(); }catch(e){} };
  },[]);

  const loadMsgs = async()=>{
    try{
      const d=await apiFetch('/community/chat?limit=200');
      const sorted = Array.isArray(d) ? [...d].sort((a,b)=>new Date(a.created_at)-new Date(b.created_at)) : [];
      setMsgs(sorted);
      // send read receipt for the latest message
      if(sorted.length){
        const last = sorted[sorted.length-1];
        try{ await apiFetch('/community/chat/read',{method:'POST',body:JSON.stringify({message_id:last.id})}); }catch(e){}
      }
    }
    catch{}
    setLoading(false);
  };

  const send = async()=>{
    const t=text.trim(); if(!t)return;
    setSending(true); setText('');
    try{
      await apiFetch('/community/chat',{method:'POST',body:JSON.stringify({message:t, reply_to_id: replyTo})});
      setReplyTo(null);
      // server will emit and we'll receive via socket
      setTimeout(()=>listRef.current?.scrollToEnd({animated:true}), 200);
    }catch(e){Alert.alert('Chyba',e.message);}    
    finally{setSending(false);} 
  };

  const openReactModal = (msg) => setReactModalFor(msg);
  const sendReaction = async(emoji) => {
    if(!reactModalFor) return;
    try{
      await apiFetch(`/community/chat/${reactModalFor.id}/react`, {method:'POST', body: JSON.stringify({emoji})});
      setReactModalFor(null);
    }catch(e){Alert.alert('Chyba',e.message)}
  };

  const renderItem=({item})=>{
    const isMe=item.user_id===user.id;
    return(
      <View style={[s.msgRow,isMe&&{flexDirection:'row-reverse'}]}>
        {!isMe&&(
          <Avatar
            url={item.avatar_url}
            size={28}
            style={{marginRight:6}}
            onPress={()=>setUserModal(item.username)}
          />
        )}
        <View style={{maxWidth:'75%'}}>
          {!isMe&&(
            <TouchableOpacity onPress={()=>setUserModal(item.username)} activeOpacity={0.7}>
              <Text style={[s.dimText,{fontSize:11,marginBottom:2,textDecorationLine:'underline'}]}>{item.username}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity onLongPress={()=>openReactModal(item)} activeOpacity={0.8}>
            <View style={[s.msgBubble,isMe&&s.msgBubbleMe]}>
              {item.reply_message && (
                <View style={{borderLeftWidth:3,borderLeftColor:'#ffffff22',paddingLeft:8,marginBottom:6}}>
                  <Text style={[s.dimText,{fontSize:11}]}>{item.reply_username}: {item.reply_message}</Text>
                </View>
              )}
              <Text style={[s.msgText,isMe&&{color:C.bg}]}>{item.message}</Text>
              {/* reactions */}
              {item.reactions && Object.keys(JSON.parse(item.reactions || '{}')).length>0 && (
                <View style={{flexDirection:'row',marginTop:6}}>
                  {Object.entries((()=>{const r=JSON.parse(item.reactions||'{}'); const s={}; Object.values(r).forEach(v=>s[v]=(s[v]||0)+1); return s;})()).map(([e,c])=> (
                    <View key={e} style={{backgroundColor:'#00000040',paddingHorizontal:8,paddingVertical:4,borderRadius:16,marginRight:6}}>
                      <Text style={{color:C.cream,fontSize:12}}>{e} {c}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </TouchableOpacity>
          <Text style={[s.dimText,{fontSize:10,marginTop:2,textAlign:isMe?'right':'left'}]}>
            {new Date(item.created_at).toLocaleTimeString('cs-CZ',{hour:'2-digit',minute:'2-digit'})}
          </Text>
        </View>
      </View>
    );
  };

  if(loading)return <View style={s.center}><ActivityIndicator color={C.amber}/></View>;
  return(
    <View style={{flex:1}}>
      <ScrollView
        ref={listRef}
        contentContainerStyle={{padding:12,paddingBottom:4}}
        onContentSizeChange={()=>listRef.current?.scrollToEnd({animated:false})}
        onLayout={()=>listRef.current?.scrollToEnd({animated:false})}
      >
        {msgs.map(item=>(
          <React.Fragment key={String(item.id)}>
            {renderItem({item})}
          </React.Fragment>
        ))}
      </ScrollView>
      <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'}>
        {replyTo && (
          <View style={{padding:8,backgroundColor:'#00000022',flexDirection:'row',alignItems:'center'}}>
            <Text style={{color:C.creamDim,flex:1}}>Odpověď: {replyTo.username}: {replyTo.message.slice(0,80)}</Text>
            <TouchableOpacity onPress={()=>setReplyTo(null)}><Ionicons name="close" size={18} color={C.creamDim}/></TouchableOpacity>
          </View>
        )}
        <View style={s.chatInput}>
          <TextInput style={[s.input,{flex:1,marginBottom:0}]} placeholder="Zpráva…" placeholderTextColor={C.creamDim}
            value={text} onChangeText={setText} onSubmitEditing={send} returnKeyType="send"/>
          <TouchableOpacity style={[s.btnPri,{paddingHorizontal:16,paddingVertical:12}]} onPress={send} disabled={sending}>
            {sending?<ActivityIndicator color={C.bg} size="small"/>:<Ionicons name="send" size={18} color={C.bg}/>} 
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* Reaction modal */}
      <Modal visible={!!reactModalFor} transparent animationType="fade">
        <TouchableOpacity style={{flex:1,backgroundColor:'#00000066',justifyContent:'center',alignItems:'center'}} activeOpacity={1} onPress={()=>setReactModalFor(null)}>
          <View style={{backgroundColor:C.bgCard,padding:12,borderRadius:12,flexDirection:'row'}}>
            {[ '👍','❤️','😂','😮','😢','🎉' ].map(e=> (
              <TouchableOpacity key={e} onPress={()=>sendReaction(e)} style={{padding:8,margin:6}}>
                <Text style={{fontSize:24}}>{e}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={()=>{ setReplyTo(reactModalFor); setReactModalFor(null); }} style={{padding:8,margin:6,justifyContent:'center'}}>
              <Text style={{color:C.cream}}>Odpovědět</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>

      {userModal&&<UserProfileModal username={userModal} selfId={user.id} onClose={()=>setUserModal(null)}/>} 
    </View>
  );
};

// Find user sub-tab
const FindUserTab = ({ user }) => {
  const [q, setQ]         = useState('');
  const [result, setResult] = useState(null);
  const [searching, setS] = useState(false);
  const [userModal, setUM] = useState(null);

  const find = async()=>{
    if(!q.trim())return; setS(true);
    try{ const d=await apiFetch(`/users/find?q=${encodeURIComponent(q)}`); setResult(d); }
    catch{ Alert.alert('Nenalezeno','Hospůdkobraník nenalezen.'); setResult(null); }
    setS(false);
  };

  return(
    <ScrollView style={{flex:1}} contentContainerStyle={{padding:16}}>
      <Text style={[s.secLabel,{marginBottom:12}]}>Najdi Hospůdkobraníka</Text>
      <View style={{flexDirection:'row',gap:8}}>
        <TextInput style={[s.input,{flex:1,marginBottom:0}]} placeholder="Přezdívka…" placeholderTextColor={C.creamDim}
          value={q} onChangeText={setQ} onSubmitEditing={find} returnKeyType="search"/>
        <TouchableOpacity style={[s.btnPri,{paddingHorizontal:16}]} onPress={find} disabled={searching}>
          {searching?<ActivityIndicator color={C.bg} size="small"/>:<Ionicons name="search" size={18} color={C.bg}/>}
        </TouchableOpacity>
      </View>
      {result&&(
        <TouchableOpacity style={[s.visitCard,{marginTop:14}]} onPress={()=>setUM(result.username)} activeOpacity={0.75}>
          <View style={{flexDirection:'row',alignItems:'center',gap:12}}>
            <Avatar url={result.avatar_url} size={52}/>
            <View style={{flex:1}}>
              <Text style={s.visitName}>{result.username}</Text>
              {result.bio&&<Text style={s.dimText}>{result.bio}</Text>}
              <View style={{flexDirection:'row',gap:16,marginTop:8}}>
                <View style={{flexDirection:'row',alignItems:'center',gap:4}}>
                  <Ionicons name="beer-outline" size={14} color={C.amber}/>
                  <Text style={{color:C.amber,fontWeight:'600',fontSize:14}}>{result.total_visits}</Text>
                </View>
                <View style={{flexDirection:'row',alignItems:'center',gap:4}}>
                  <Ionicons name="star" size={14} color={C.star}/>
                  <Text style={{color:C.amber,fontWeight:'600',fontSize:14}}>{result.avg_rating?.toFixed(1)??'–'}</Text>
                </View>
                {result.firstlast_count>0&&(
                  <View style={{flexDirection:'row',alignItems:'center',gap:4}}>
                    <Ionicons name="ribbon-outline" size={14} color={C.purple}/>
                    <Text style={{color:C.purple,fontWeight:'600',fontSize:14}}>{result.firstlast_count}</Text>
                  </View>
                )}
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={C.border}/>
          </View>
          <Text style={[s.dimText,{fontSize:11,marginTop:8}]}>Člen od {new Date(result.created_at).toLocaleDateString('cs-CZ')}</Text>
        </TouchableOpacity>
      )}
      {userModal&&<UserProfileModal username={userModal} selfId={user.id} onClose={()=>setUM(null)}/>}
    </ScrollView>
  );
};

const GalleryTab = ({ user }) => {
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefr] = useState(false);
  const [pv, setPv] = useState(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  useEffect(()=>{ load(1,true); },[]);

  const load = async(p=page, reset=false)=>{
    try{
      const d=await apiFetch(`/community/gallery?page=${p}&limit=18`);
      setPhotos(prev=>reset?d:(prev.some(x=>d[0]&&x.id===d[0].id)?prev:[...prev,...d]));
      setHasMore(d.length===18);
    }catch{}
    setLoading(false); setRefr(false);
  };

  const loadMore = ()=>{ if(!hasMore)return; const p=page+1; setPage(p); load(p); };

  const likePhoto = async (photoId) => {
    setPhotos(prev=>prev.map(p=>p.id===photoId
      ? {...p, liked:!p.liked, like_count:(p.like_count||0)+(p.liked?-1:1)}
      : p
    ));
    try { await apiFetch(`/community/gallery/${photoId}/like`,{method:'POST'}); }
    catch { setPhotos(prev=>prev.map(p=>p.id===photoId
      ? {...p, liked:!p.liked, like_count:(p.like_count||0)+(p.liked?1:-1)}
      : p
    ));}
  };

  const handleLikeUpdate = (photoId, liked, likeCount) => {
    setPhotos(prev => prev.map(p => p.id === photoId ? {...p, liked, like_count: likeCount} : p));
  };

  if(loading)return <View style={s.center}><ActivityIndicator color={C.amber} size="large"/></View>;
  const COLS=3, SIZE=(SW-32-8*2)/3;
  return(
    <View style={{flex:1}}>
      <FlatList data={photos} keyExtractor={i=>String(i.id)} numColumns={COLS}
        contentContainerStyle={{padding:8,paddingBottom:20}}
        columnWrapperStyle={{gap:4}}
        refreshControl={<RefreshControl refreshing={refreshing} tintColor={C.amber} colors={[C.amber]}
          onRefresh={()=>{setRefr(true);setPage(1);load(1,true);}}/>}
        onEndReached={loadMore} onEndReachedThreshold={0.4}
        renderItem={({item,index})=>(
          <View style={{position:'relative',marginBottom:4}}>
            <TouchableOpacity onPress={()=>setPv(index)} activeOpacity={0.85}>
              <Image source={{uri:item.url}} style={{width:SIZE,height:SIZE,borderRadius:6}} resizeMode="cover"/>
            </TouchableOpacity>
            <TouchableOpacity style={s.photoLikeBtn} onPress={()=>likePhoto(item.id)}>
              <Ionicons name={item.liked?'heart':'heart-outline'} size={14} color={item.liked?C.red:C.white}/>
              {(item.like_count||0)>0 && <Text style={s.photoLikeT}>{item.like_count}</Text>}
            </TouchableOpacity>
          </View>
        )}
        ListEmptyComponent={<View style={s.empty}><Ionicons name="images-outline" size={60} color={C.border}/><Text style={s.emptyT}>Žádné fotky</Text></View>}
      />
      {pv!==null&&<PhotoViewer photos={photos} startIndex={pv} onClose={()=>setPv(null)} userId={user.id} onLikeUpdate={handleLikeUpdate} />}
    </View>
  );
};

// Community screen container with sub-tabs
const CommunityScreen = ({ user }) => {
  const [tab, setTab] = useState('leaderboard');
const SUB_TABS = [
    {key:'leaderboard', label:'Žebříček',   icon:'trophy-outline'},
    {key:'chat',        label:'Chaty',       icon:'chatbubbles-outline'},
    {key:'find',        label:'Hledání',     icon:'search-outline'},
    {key:'gallery',     label:'Galerie',     icon:'images-outline'},
  ];

  return(
    <View style={s.screen}>
      <View style={s.pageHdr}>
        <Text style={s.pageTitle}>Komunita</Text>
      </View>
      {/* Sub-tab bar */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flexGrow:0,marginBottom:4}} contentContainerStyle={{paddingHorizontal:16,gap:8,paddingBottom:8}}>
        {SUB_TABS.map(t=>(
          <TouchableOpacity key={t.key} style={[s.subTab,tab===t.key&&s.subTabOn]} onPress={()=>setTab(t.key)}>
            <Ionicons name={t.icon} size={16} color={tab===t.key?C.bg:C.creamDim}/>
            <Text style={[s.subTabT,tab===t.key&&s.subTabTOn]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <View style={{flex:1}}>
        {tab==='leaderboard' && <LeaderboardTab user={user}/>}
        {tab==='chat'        && <ChatTab user={user}/>}
        {tab==='find'        && <FindUserTab user={user}/>}
        {tab==='gallery'     && <GalleryTab user={user}/>}

      </View>

    </View>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// ACTIVITY CALENDAR HEATMAP
// ══════════════════════════════════════════════════════════════════════════════
const ActivityCalendar = () => {
  const now = new Date();
  const [year, setYear]   = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [active, setActive] = useState(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState(null);
  const [dayVisits, setDayVisits] = useState([]);
  const [showDayModal, setShowDayModal] = useState(false);
  const [selectedPub, setSelectedPub] = useState(null);
  const [showPubDetail, setShowPubDetail] = useState(false);

  const handleDayClick = async (day) => {
    const monthStr = month.toString().padStart(2, '0');
    const dayStr = day.toString().padStart(2, '0');
    const dateStr = `${year}-${monthStr}-${dayStr}`;
    try {
      const visits = await apiFetch(`/visits/my?date=${dateStr}`);
      setDayVisits(visits);
      setSelectedDate(dateStr);
      setShowDayModal(true);
    } catch (e) {
      Alert.alert('Chyba', 'Nepodařilo se načíst návštěvy.');
    }
  };

  useEffect(() => {
    setLoading(true);
    apiFetch(`/profile/activity?year=${year}&month=${month}`)
      .then(res => {
        // Server vrací {year, month, days: {"2026-04-01": count, ...}}
        const daysObj = res?.days || {};
        setActive(new Set(Object.keys(daysObj).map(d => new Date(d).getDate())));
      })
      .catch(() => setActive(new Set()))
      .finally(() => setLoading(false));
  }, [year, month]);

  const prevMonth = () => { if (month === 1) { setYear(y => y-1); setMonth(12); } else setMonth(m => m-1); };
  const nextMonth = () => { if (month === 12) { setYear(y => y+1); setMonth(1); } else setMonth(m => m+1); };
  const daysInMonth = new Date(year, month, 0).getDate();
  const startOffset = (new Date(year, month - 1, 1).getDay() + 6) % 7;
  const monthName = new Date(year, month - 1).toLocaleString('cs-CZ', { month: 'long' });
  // Přesný výpočet: karta má margin:16 (→ -32) a padding:14 (→ -28) = SW-60, pak ÷7
  const cellW = Math.floor((SW - 60) / 7);
  const numRows = Math.ceil((startOffset + daysInMonth) / 7);

  return (
    <><View style={{ margin: 16, backgroundColor: C.bgCard, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: C.border }}>
      <Text style={[s.secLabel, { marginBottom: 10 }]}>Aktivita</Text>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <TouchableOpacity onPress={prevMonth}><Ionicons name="chevron-back" size={20} color={C.amber} /></TouchableOpacity>
        <Text style={{ color: C.cream, fontWeight: '700', fontSize: 15 }}>{monthName} {year}</Text>
        <TouchableOpacity onPress={nextMonth}><Ionicons name="chevron-forward" size={20} color={C.amber} /></TouchableOpacity>
      </View>
      {loading ? <ActivityIndicator color={C.amber} style={{ marginVertical: 10 }} /> : (
        <View>
          {/* Záhlaví dnů týdne */}
          <View style={{ flexDirection: 'row', marginBottom: 6 }}>
            {['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map(d => (
              <Text key={d} style={{ width: cellW, textAlign: 'center', color: C.creamDim, fontSize: 10, fontWeight: '700' }}>{d}</Text>
            ))}
          </View>
          {/* Týdenní řádky */}
          {Array.from({ length: numRows }, (_, r) => (
            <View key={r} style={{ flexDirection: 'row', marginBottom: 3 }}>
              {Array.from({ length: 7 }, (_, c) => {
                const idx = r * 7 + c;
                const day = idx - startOffset + 1;
                if (day < 1 || day > daysInMonth) return <View key={c} style={{ width: cellW, height: cellW }} />;
                const isActive = active.has(day);
                const isToday = year === now.getFullYear() && month === now.getMonth() + 1 && day === now.getDate();
                return (
                  <TouchableOpacity
                    key={c}
                    onPress={() => handleDayClick(day)}
                    style={{ width: cellW, height: cellW, alignItems: 'center', justifyContent: 'center' }}
                  >
                    <View style={{
                      width: cellW - 5, height: cellW - 5, borderRadius: (cellW - 5) / 2,
                      backgroundColor: isActive ? C.amber : 'transparent',
                      borderWidth: isToday ? 1.5 : 0, borderColor: C.teal,
                      alignItems: 'center', justifyContent: 'center'
                    }}>
                      <Text style={{ color: isActive ? C.bg : isToday ? C.teal : C.creamDim, fontSize: 11, fontWeight: isActive || isToday ? '800' : '400' }}>
                        {day}
                      </Text>
                    </View>
                  </TouchableOpacity>

                );
              })}
            </View>
          ))}
        </View>

      )}
    </View><Modal
      visible={showDayModal}
      transparent
      animationType="slide"
      onRequestClose={() => setShowDayModal(false)}
    >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center',
          padding: 20
        }}>
          <View style={{
            backgroundColor: C.bgCard,
            borderRadius: 16,
            padding: 16
          }}>
            <Text style={{ color: C.cream, fontSize: 16, fontWeight: '700', marginBottom: 10 }}>
              Návštěvy: {selectedDate}
            </Text>

            {dayVisits.length === 0 ? (
              <Text style={{ color: C.creamDim }}>Nic tady není… asi detox den 😄</Text>
            ) : (
              dayVisits.map((visit, i) => (
                <Text key={i} style={{ color: C.cream, marginBottom: 6 }}>
                  • {visit.pub_name || 'Neznámá hospoda'}
                </Text>
              ))
            )}

            <TouchableOpacity
              onPress={() => setShowDayModal(false)}
              style={{
                marginTop: 12,
                padding: 10,
                backgroundColor: C.amber,
                borderRadius: 10,
                alignItems: 'center'
              }}
            >
              <Text style={{ color: C.bg, fontWeight: '700' }}>Zavřít</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal></>
  
  );
  
};

// ══════════════════════════════════════════════════════════════════════════════
// PROFILE SCREEN (renovated with likes on my photos and new like notifications)
// ══════════════════════════════════════════════════════════════════════════════
const ProfileScreen = ({ user, onLogout, onShowTutorial }) => {
  const [me, setMe]             = useState(user);
  const [editBio, setEditBio]   = useState(false);
  const [bio, setBio]           = useState(user.bio||'');
  const [stats, setStats]       = useState(null);
  const [period, setPeriod]     = useState('total');
  const [photos, setPhotos]     = useState([]);
  const [rank, setRank]         = useState(null);
  const [pv, setPv]             = useState(null);
  const [offQ, setOffQ]         = useState(0);
  const [syncing, setSyncing]   = useState(false);
  const [loading, setLoading]   = useState(true);
  const [changePwMod, setChangePwMod] = useState(false);
  const [delAccMod, setDelAccMod]     = useState(false);
  const [delPw, setDelPw]             = useState('');
  const [delLoading, setDelLoading]   = useState(false);

  useEffect(()=>{ loadAll(); checkOff(); const interval = setInterval(checkNewLikes, 60000); return () => clearInterval(interval); },[]);
  useEffect(()=>{ loadStats(); },[period]);

  const loadAll = async()=>{
    await Promise.all([loadStats(), loadPhotos(), loadRank()]);
    setLoading(false);
  };

  const loadStats = async()=>{
    try{ const d=await apiFetch(`/profile/stats?period=${period}`); setStats(d); }catch{}
  };

  const loadPhotos = async()=>{
    try{ const d=await apiFetch('/profile/my-photos'); setPhotos(d); }catch{}
  };

  const deleteMyPhoto = (photoId) => {
    Alert.alert('Smazat fotku?', 'Tuto akci nelze vrátit.', [
      { text: 'Zrušit', style: 'cancel' },
      { text: 'Smazat', style: 'destructive', onPress: async () => {
        try {
          await apiFetch('/photos/' + photoId, { method: 'DELETE' });
          setPhotos(prev => prev.filter(ph => ph.id !== photoId));
        } catch(e) { Alert.alert('Chyba', 'Nepodařilo se smazat fotku.'); }
      }},
    ]);
  };

  const loadRank = async()=>{
    try{ const d=await apiFetch('/profile/rank'); setRank(d); }catch{}
  };

  const checkOff = async()=>{ const q=await getQ(); setOffQ(q.length); };

  const syncOff = async()=>{
    setSyncing(true); const q=await getQ(); let n=0;
    for(const i of q){ try{ if(i.type==='visit'){await apiFetch('/visits',{method:'POST',body:JSON.stringify(i.payload)});n++;} }catch{} }
    if(n>0){ await clearQ(); setOffQ(0); bust(`v_${user.id}`); bust(`vd_${user.id}`); Alert.alert('Sync','Synchronizováno '+n+' odkliknutí!'); }
    else Alert.alert('Sync','Nic k synchronizaci.');
    setSyncing(false);
  };

  const checkNewLikes = async () => {
    const lastCheck = await AsyncStorage.getItem('lastLikeCheck');
    try {
      const res = await apiFetch(`/notifications/likes?since=${encodeURIComponent(lastCheck || '1970-01-01')}`);
      if (res.count > 0) await scheduleLocalNotification('Nový like!', `Někdo ti dal like na fotce.`);
      await AsyncStorage.setItem('lastLikeCheck', new Date().toISOString());
    } catch(e) {}
  };

  const pickAvatar = async()=>{
    const {status}=await ImagePicker.requestMediaLibraryPermissionsAsync();
    if(status!=='granted')return;
    const r=await ImagePicker.launchImageLibraryAsync({mediaTypes:ImagePicker.MediaTypeOptions.Images,quality:0.7,allowsEditing:true,aspect:[1,1]});
    if(!r.canceled){
      const fd=new FormData();
      fd.append('avatar',{uri:r.assets[0].uri,name:'avatar.jpg',type:'image/jpeg'});
      try{
        const res=await fetch(`${API}/profile/avatar`,{method:'POST',headers:{Authorization:`Bearer ${await getToken()}`},body:fd});
        const d=await res.json();
        const upd={...me,avatar_url:d.avatar_url}; setMe(upd);
        await AsyncStorage.setItem('user_data',JSON.stringify(upd));
      }catch(e){Alert.alert('Chyba',e.message);}
    }
  };

  const deleteAvatar = ()=>{
    Alert.alert('Smazat profilovku?','Profilovka bude odstraněna.',[
      {text:'Zrušit',style:'cancel'},
      {text:'Smazat',style:'destructive',onPress:async()=>{
        try{
          await apiFetch('/profile/avatar',{method:'DELETE'});
          const upd={...me,avatar_url:null}; setMe(upd);
          await AsyncStorage.setItem('user_data',JSON.stringify(upd));
        }catch(e){Alert.alert('Chyba',e.message);}
      }},
    ]);
  };

  const saveBio = async()=>{
    try{ await apiFetch('/profile/bio',{method:'PUT',body:JSON.stringify({bio})}); setMe(p=>({...p,bio})); setEditBio(false); }
    catch(e){ Alert.alert('Chyba',e.message); }
  };

  const logout = ()=>{
    Alert.alert('Odhlásit?','Opravdu?',[
      {text:'Zrušit',style:'cancel'},
      {text:'Odhlásit',style:'destructive',onPress:async()=>{ await AsyncStorage.multiRemove(['auth_token','user_data']); onLogout(); }},
    ]);
  };

  const deleteAccount = () => {
    setDelPw('');
    setDelAccMod(true);
  };

  const confirmDeleteAccount = async () => {
    if (!delPw) return;
    setDelLoading(true);
    try {
      await apiFetch('/auth/delete-account', {method:'DELETE', body:JSON.stringify({password: delPw})});
      await AsyncStorage.multiRemove(['auth_token','user_data']);
      onLogout();
    } catch(e) {
      Alert.alert('Chyba', e.message);
    } finally {
      setDelLoading(false);
    }
  };

  const PERIODS=[['total','Celkem'],['year','Rok'],['month','Měsíc'],['day','Den']];

  return(
    <ScrollView style={s.screen} contentContainerStyle={{paddingBottom:100}}>
      <View style={s.pageHdr}><Text style={s.pageTitle}>Profil</Text></View>

      {/* Avatar + info */}
      <View style={s.profileCard}>
        <View style={{position:'relative',marginBottom:12}}>
          <TouchableOpacity onPress={pickAvatar}>
            <Avatar url={me.avatar_url} size={90}/>
            <View style={s.avatarEdit}><Ionicons name="camera-outline" size={14} color={C.bg}/></View>
          </TouchableOpacity>
          {me.avatar_url && (
            <TouchableOpacity style={s.avatarDel} onPress={deleteAvatar}>
              <Ionicons name="trash-outline" size={13} color={C.white}/>
            </TouchableOpacity>
          )}
        </View>
        <Text style={s.profileName}>{me.username}</Text>
        <Text style={s.dimText}>{me.email}</Text>

        {rank&&(
          <View style={{flexDirection:'row',alignItems:'center',gap:6,marginTop:8,padding:8,backgroundColor:C.bgCardAlt,borderRadius:10,borderWidth:1,borderColor:C.border}}>
            <Ionicons name="trophy-outline" size={16} color={C.gold}/>
            <Text style={{color:C.gold,fontWeight:'700',fontSize:13}}>#{rank.position} v žebříčku</Text>
            <Text style={s.dimText}>· {rank.total_users} hráčů</Text>
          </View>
        )}

        {editBio?(
          <View style={{width:'100%',marginTop:10}}>
            <TextInput style={[s.input,{minHeight:60}]} value={bio} onChangeText={setBio}
              placeholder="Napiš něco o sobě…" placeholderTextColor={C.creamDim} multiline/>
            <View style={{flexDirection:'row',gap:8}}>
              <TouchableOpacity style={[s.btnSec,{flex:1}]} onPress={()=>setEditBio(false)}>
                <Text style={{color:C.creamDim,textAlign:'center'}}>Zrušit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.btnPri,{flex:1}]} onPress={saveBio}>
                <Text style={s.btnPriT}>Uložit</Text>
              </TouchableOpacity>
            </View>
          </View>
        ):(
          <TouchableOpacity onPress={()=>setEditBio(true)} style={{marginTop:8}}>
            <Text style={s.bioText}>{me.bio||'+ Přidat bio'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Period selector */}
      <View style={{flexDirection:'row',gap:8,paddingHorizontal:16,marginBottom:12}}>
        {PERIODS.map(([k,l])=>(
          <TouchableOpacity key={k} style={[s.sortBtn,period===k&&s.sortBtnOn,{flex:1}]} onPress={()=>setPeriod(k)}>
            <Text style={[s.sortBtnT,period===k&&s.sortBtnTOn,{textAlign:'center'}]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stats */}
      <View style={s.statsGrid}>
        {[
          ['beer-outline',   stats?.total_visits,              'hospůdek',      C.amber],
          ['star-outline',   stats?.avg_rating?.toFixed(1),    'průměr ★',      C.star],
          ['ribbon-outline', stats?.firstlast_count,           'prvochlasty',   C.purple],
          ['trophy-outline', stats?.challenges_done,           'výzev',         C.gold],
          ['walk-outline',   stats?.unique_pubs,               'unikátní',      C.teal],
          ['flame-outline',  stats?.streak_days,               'dní streak',    C.red],
        ].map(([icon,val,label,color],i)=>(
          <View key={i} style={s.statsGridItem}>
            <Ionicons name={icon} size={22} color={color} style={{marginBottom:4}}/>
            <Text style={[s.statsGridNum,{color}]}>{!stats ? '…' : (val??'–')}</Text>
            <Text style={s.statsGridLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {/* My photos with like counts + private indicator */}
      {photos.length>0&&(
        <View style={{marginHorizontal:16,marginBottom:16}}>
          <Text style={s.secLabel}>Moje fotky ({photos.length})</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {photos.map((p,i)=>(
              <View key={i} style={{marginRight:8,position:'relative'}}>
                <TouchableOpacity onPress={()=>setPv(i)} activeOpacity={0.85}>
                  <Image source={{uri:p.url}} style={{width:90,height:80,borderRadius:10}} resizeMode="cover"/>
                </TouchableOpacity>
                <View style={s.photoLikeBtnMini}>
                  <Ionicons name="heart-outline" size={10} color={C.white}/>
                  <Text style={{color:C.white,fontSize:9,marginLeft:2}}>{p.like_count || 0}</Text>
                </View>
                {(p.visibility==='private'||p.photo_visibility==='private') && (
                  <View style={{position:'absolute',top:4,left:4,backgroundColor:'rgba(0,0,0,0.6)',borderRadius:8,padding:3}}>
                    <Ionicons name="lock-closed" size={11} color={C.amber}/>
                  </View>
                )}
                <TouchableOpacity
                  onPress={()=>deleteMyPhoto(p.id)}
                  style={{position:'absolute',top:4,right:4,backgroundColor:'rgba(0,0,0,0.65)',borderRadius:8,padding:3}}>
                  <Ionicons name="trash-outline" size={13} color={C.red}/>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Activity calendar heatmap */}
      <ActivityCalendar/>

      {/* Offline sync */}
      {offQ>0&&(
        <View style={s.offBanner}>
          <Ionicons name="cloud-offline-outline" size={18} color={C.amber}/>
          <Text style={{color:C.cream,flex:1,fontSize:13}}>{offQ} odkliknutí čeká na sync</Text>
          <TouchableOpacity style={s.syncBtn} onPress={syncOff} disabled={syncing}>
            {syncing?<ActivityIndicator size="small" color={C.bg}/>:<Text style={{color:C.bg,fontWeight:'800',fontSize:13}}>Sync</Text>}
          </TouchableOpacity>
        </View>
      )}

  {/* Settings */}
  <View style={{margin:16,marginTop:0}}>
    <Text style={s.secLabel}>Nastavení</Text>
    
    {/* Avatar privacy toggle */}
    <TouchableOpacity style={s.settRow} onPress={async () => {
      const current = me.avatar_privacy || 'public';
      const newPrivacy = current === 'public' ? 'followers_only' : 'public';
      try {
        const res = await apiFetch('/profile/settings', {
          method: 'PUT',
          body: JSON.stringify({ avatar_privacy: newPrivacy })
        });
        setMe(prev => ({ ...prev, avatar_privacy: newPrivacy }));
      } catch (e) {
        Alert.alert('Chyba', e.message);
      }
    }}>
      <Ionicons name="lock-closed-outline" size={18} color={C.amber}/>
      <Text style={{fontSize:15,fontWeight:'600',color:C.cream}}>
        Profilovka {(me.avatar_privacy === 'followers_only' || me.avatar_privacy === 'private') ? 'pouze sledující' : 'veřejná'}
      </Text>
      <View style={{flexDirection:'row',alignItems:'center',gap:4,marginLeft:'auto'}}>
        <View style={{
          width:20,height:20,borderRadius:10,backgroundColor:(me.avatar_privacy === 'followers_only' || me.avatar_privacy === 'private') ? C.green : C.bgCardAlt,
          borderWidth:1,borderColor:C.border,justifyContent:'center',alignItems:'center'
        }}>
          <Ionicons name={(me.avatar_privacy === 'followers_only' || me.avatar_privacy === 'private') ? 'checkmark' : 'ellipse'} size={12} color={C.white}/>
        </View>
        <Ionicons name="chevron-forward" size={16} color={C.border}/>
      </View>
    </TouchableOpacity>

    {/* Map remember position toggle */}
    <TouchableOpacity style={s.settRow} onPress={async () => {
      const current = me.map_remember_position || false;
      const newSetting = !current;
      try {
        await apiFetch('/profile/settings', {
          method: 'PUT',
          body: JSON.stringify({ map_remember_position: newSetting })
        });
        setMe(prev => ({ ...prev, map_remember_position: newSetting }));
        if (!newSetting) {
          await AsyncStorage.removeItem('map_viewport');
        }
      } catch (e) {
        Alert.alert('Chyba', e.message);
      }
    }}>
      <Ionicons name="bookmark-outline" size={18} color={C.amber}/>
      <Text style={{fontSize:15,fontWeight:'600',color:C.cream}}>
        Ukládat pozici mapy {(me.map_remember_position === true) ? 'zapnuto' : 'vypnuto'}
      </Text>
      <View style={{flexDirection:'row',alignItems:'center',gap:4,marginLeft:'auto'}}>
        <View style={{
          width:20,height:20,borderRadius:10,backgroundColor:(me.map_remember_position === true) ? C.green : C.bgCardAlt,
          borderWidth:1,borderColor:C.border,justifyContent:'center',alignItems:'center'
        }}>
          <Ionicons name={(me.map_remember_position === true) ? 'checkmark' : 'ellipse'} size={12} color={C.white}/>
        </View>
        <Ionicons name="chevron-forward" size={16} color={C.border}/>
      </View>
    </TouchableOpacity>

    <TouchableOpacity style={s.settRow} onPress={()=>setChangePwMod(true)}>
      <Ionicons name="lock-closed-outline" size={18} color={C.amber}/>
      <Text style={{fontSize:15,fontWeight:'600',color:C.cream}}>Změnit heslo</Text>
      <Ionicons name="chevron-forward" size={16} color={C.border} style={{marginLeft:'auto'}}/>
    </TouchableOpacity>
    <TouchableOpacity style={s.settRow} onPress={logout}>
      <Ionicons name="log-out-outline" size={18} color={C.red}/>
      <Text style={{fontSize:15,fontWeight:'600',color:C.red}}>Odhlásit se</Text>
    </TouchableOpacity>
    <TouchableOpacity style={s.settRow} onPress={deleteAccount}>
      <Ionicons name="trash-outline" size={18} color='#C0392B'/>
      <Text style={{fontSize:15,fontWeight:'600',color:'#C0392B'}}>Smazat účet</Text>
    </TouchableOpacity>
    <TouchableOpacity style={s.settRow} onPress={onShowTutorial}>
      <Ionicons name="help-circle-outline" size={18} color={C.amber}/>
      <Text style={{fontSize:15,fontWeight:'600',color:C.cream}}>Znovu zobrazit návod</Text>
      <Ionicons name="chevron-forward" size={16} color={C.border} style={{marginLeft:'auto'}}/>
    </TouchableOpacity>
  </View>


      {/* Verze + sociální sítě + GDPR + Copyrighty */}
      <TouchableOpacity onPress={() => Alert.alert(
        'GDPR & Copyright Info',
        `GDPR INFORMACE:\n\nTato aplikace shromažďuje osobní údaje v souladu s GDPR (Nařízení EU 2016/679).\n\nShromažďované údaje:\n- Uživatelské jméno, email, heslo\n- Poloha zařízení pro mapové funkce\n- Fotografie a komentáře\n- Statistiky návštěv hospod\n\nÚdaje se používají pouze pro funkčnost aplikace a nejsou sdíleny s třetími stranami bez souhlasu.\n\nPráva uživatele:\n- Právo na přístup k údajům\n- Právo na opravu\n- Právo na výmaz\n- Kontakt: noemiamisa@gmail.com\n\nCOPYRIGHTY:\n\n© Mapbox - Mapové dlaždice a data\n© GraphHopper - Směrovací služby\n© React Native & Expo - Framework\n© Michal Schneider - Kód aplikace, styl mapy apod.\n\nVšechna práva vyhrazena.`
      )}>
        <Text style={{color:C.creamDim,fontSize:12,textAlign:'center',marginBottom:8,textDecorationLine:'underline'}}>Hospůdkobraní v1.4.7 (BETA) - GDPR & Copyright Info</Text>
      </TouchableOpacity>
      <Text style={{color:C.creamDim,fontSize:12,textAlign:'center',marginBottom:16}}>© 2026 Michal S. & Zuzka Smejkalová & Anna Bystřická - Všechna práva vyhrazena</Text>
      <View style={{flexDirection:'row',justifyContent:'center',gap:24,paddingBottom:16}}>
        <TouchableOpacity onPress={()=>Linking.openURL('https://www.facebook.com/profile.php?id=100091510912279')}>
          <MaterialCommunityIcons name="facebook" size={30} color='#1877F2'/>
        </TouchableOpacity>
        <TouchableOpacity onPress={()=>Linking.openURL('https://www.instagram.com/michalzplzne44/')}>
          <MaterialCommunityIcons name="instagram" size={30} color='#E4405F'/>
        </TouchableOpacity>
        <TouchableOpacity onPress={()=>Linking.openURL('https://www.youtube.com/@MiKing4410')}>
          <MaterialCommunityIcons name="youtube" size={30} color='#FF0000'/>
        </TouchableOpacity>
      </View>

      {pv!==null && photos.length>0 && <PhotoViewer photos={photos.map(p=>({...p, liked:false, like_count: p.like_count || 0, username: me.username}))} startIndex={pv} onClose={()=>setPv(null)} userId={user.id} />}
      {changePwMod && <ChangePasswordModal onClose={()=>setChangePwMod(false)}/>}

      <Modal visible={delAccMod} transparent animationType="fade" onRequestClose={()=>setDelAccMod(false)}>
        <View style={s.modalOverlay}>
          <View style={[s.modalCard,{gap:12}]}>
            <Text style={[s.modalTitle,{color:C.red}]}>Smazat účet</Text>
            <Text style={{color:C.creamDim,textAlign:'center',lineHeight:20}}>Tato akce je nevratná. Zadej své heslo pro potvrzení.</Text>
            <TextInput
              style={[s.input,{marginTop:4}]}
              placeholder="Heslo"
              placeholderTextColor={C.creamDim}
              secureTextEntry
              value={delPw}
              onChangeText={setDelPw}
              autoFocus
            />
            <View style={{flexDirection:'row',gap:10,marginTop:4}}>
              <TouchableOpacity style={[s.btnSec,{flex:1,justifyContent:'center'}]} onPress={()=>setDelAccMod(false)}>
                <Text style={{color:C.cream,textAlign:'center',fontWeight:'600'}}>Zrušit</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.btnPri,{flex:1,backgroundColor:C.red,opacity:delLoading||!delPw?0.5:1}]}
                onPress={confirmDeleteAccount}
                disabled={delLoading||!delPw}
              >
                {delLoading
                  ? <ActivityIndicator color={C.white} size="small"/>
                  : <Text style={s.btnPriT}>Smazat účet</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB BAR
// ══════════════════════════════════════════════════════════════════════════════
const TABS = {
  map:       {on:'map',        off:'map-outline',        label:'Domů'},
  visits:    {on:'beer',       off:'beer-outline',       label:'Hospůdky'},
  community: {on:'people',     off:'people-outline',     label:'Komunita'},
  challenges:{on:'ribbon',     off:'ribbon-outline',     label:'Výzvy'},
  profile:   {on:'person',     off:'person-outline',     label:'Profil'},
};

const TabBar = ({ active, onTab }) => (
  <View style={s.tabBar}>
    {Object.entries(TABS).map(([key,cfg])=>{
      const on=active===key;
      return(
        <TouchableOpacity key={key} style={s.tabItem} onPress={()=>onTab(key)} activeOpacity={0.7}>
          <Ionicons name={on?cfg.on:cfg.off} size={22} color={on?C.amber:C.creamDim}/>
          <Text style={[s.tabLabel,{color:on?C.amber:C.creamDim}]}>{cfg.label}</Text>
          {on&&<View style={s.tabDot}/>}
        </TouchableOpacity>
      );
    })}
  </View>
);

// ══════════════════════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser]   = useState(null);
  const [boot, setBoot]   = useState(true);
  const [tab, setTab]     = useState('map');
  const [deepLinkPubId, setDeepLinkPubId] = useState(null);
  const [showTutorial, setShowTutorial] = useState(false);

  useEffect(()=>{
    (async()=>{
      try{
        const [tk,ud]=await Promise.all([AsyncStorage.getItem('auth_token'),AsyncStorage.getItem('user_data')]);
        if(tk&&ud){
          setUser(JSON.parse(ud));
          apiFetch('/auth/me')
            .then(u=>{ setUser(u); AsyncStorage.setItem('user_data',JSON.stringify(u)); })
            .catch(async()=>{
              const net=await NetInfo.fetch();
              if(net.isConnected){
                await AsyncStorage.multiRemove(['auth_token','user_data']);
                setUser(null);
              }
            });
        }
      }catch{}
      setBoot(false);
    })();
  },[]);

  // Deep linking: handle incoming URLs (hospudkobrani://pub/123 or https://.../pub/123)
  useEffect(()=>{
    const parseAndHandle = (url) => {
      if(!url) return;
      try{
        const m = String(url).match(/pub\/(\d+)/);
        if(m && m[1]){
          setTab('map');
          setDeepLinkPubId(m[1]);
        }
      }catch(e){/* ignore */}
    };
    // initial
    Linking.getInitialURL().then(url=>parseAndHandle(url)).catch(()=>{});
    // listener
    const onUrl = ({url}) => parseAndHandle(url);
    const sub = Linking.addEventListener ? Linking.addEventListener('url', onUrl) : Linking.addListener('url', onUrl);
    return ()=>{ try{sub.remove?.();}catch(e){} };
  },[]);

  useEffect(() => {
    if (!user) return;
    apiFetch('/user/onboarding')
      .then(res => {
        if (!res.seen) {
          setShowTutorial(true);
          apiFetch('/user/onboarding', {method:'POST', body: JSON.stringify({seen: true})}).catch(()=>{});
        }
      })
      .catch(()=>{});
  }, [user]);

  if(boot) return(
    <View style={[s.center,{backgroundColor:C.bg}]}>
      <Ionicons name="beer" size={64} color={C.amber}/>
      <Text style={s.authTitle}>Hospůdkobraní</Text>
      <ActivityIndicator color={C.amber} style={{marginTop:20}}/>
    </View>
  );

  if(!user) return <AuthScreen onLogin={setUser}/>;

  return(
    <View style={{flex:1,backgroundColor:C.bg}}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg}/>
      <View style={{flex:1}}>
        {/* MapScreen zůstává namountovaný – předchází šedé obrazovce po přepnutí */}
        <View style={{flex:1,display: tab==='map' ? 'flex' : 'none'}}>
          <MapScreen user={user} deepLinkPubId={deepLinkPubId} onDeepLinkHandled={()=>setDeepLinkPubId(null)}/>
        </View>
        {tab==='visits'     && <VisitsScreen user={user}/>}
        {tab==='community'  && <CommunityScreen user={user}/>}
        {tab==='challenges' && <ChallengesScreen user={user}/>}
        {tab==='profile'    && <ProfileScreen user={user} onLogout={()=>setUser(null)} onShowTutorial={()=>setShowTutorial(true)} />}
      </View>
      <TabBar active={tab} onTab={setTab}/>
      <TutorialModal visible={showTutorial} onClose={()=>setShowTutorial(false)} />
    </View>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen: {flex:1,backgroundColor:C.bg},
  center: {flex:1,backgroundColor:C.bg,alignItems:'center',justifyContent:'center'},

  // Auth
  authTitle:  {fontSize:30,fontWeight:'900',color:C.amber,letterSpacing:1,textAlign:'center'},
  authSub:    {color:C.creamDim,fontSize:14,marginTop:4,marginBottom:28,textAlign:'center'},
  authCard:   {backgroundColor:C.bgCard,borderRadius:20,padding:20,width:'100%',borderWidth:1,borderColor:C.border},
  authTabs:   {flexDirection:'row',marginBottom:16,borderRadius:12,overflow:'hidden',borderWidth:1,borderColor:C.border},
  authTab:    {flex:1,paddingVertical:10,alignItems:'center'},
  authTabOn:  {backgroundColor:C.amber},
  authTabT:   {color:C.creamDim,fontWeight:'600'},
  authTabTOn: {color:C.bg},
  authFooter: {color:C.creamDim,fontSize:12,marginTop:24},

  input: {backgroundColor:C.bgCardAlt,borderRadius:12,paddingHorizontal:14,paddingVertical:12,color:C.cream,borderWidth:1,borderColor:C.border,marginBottom:12,fontSize:15},

  btnPri:  {backgroundColor:C.amber,borderRadius:14,paddingVertical:13,alignItems:'center',flexDirection:'row',justifyContent:'center',gap:8},
  btnPriT: {color:C.bg,fontWeight:'800',fontSize:15},
  btnSec:  {borderWidth:1,borderColor:C.border,borderRadius:14,paddingVertical:12,paddingHorizontal:14,alignItems:'center',justifyContent:'center'},
  btnOk:   {borderWidth:1,borderColor:C.green,borderRadius:14,paddingVertical:12,alignItems:'center',flexDirection:'row',justifyContent:'center',gap:8},

  // Map
  mapPin:        {width:38,height:38,borderRadius:19,backgroundColor:'#1A1200',borderWidth:2,borderColor:C.amberDark,alignItems:'center',justifyContent:'center',shadowColor:'#000',shadowOffset:{width:0,height:2},shadowOpacity:0.5,shadowRadius:4,elevation:4},
  mapPinVisited: {borderColor:C.green,backgroundColor:'#0A1A00',width:46,height:46,borderRadius:23},
  mapHud:        {position:'absolute',top:50,left:16,flexDirection:'row',gap:10},
  mapHudBox:     {backgroundColor:'rgba(15,10,0,0.88)',borderRadius:12,paddingHorizontal:14,paddingVertical:8,borderWidth:1,borderColor:C.amber,alignItems:'center'},
  mapHudN:       {color:C.amber,fontWeight:'900',fontSize:20},
  mapHudL:       {color:C.creamDim,fontSize:11},
  mapCtrl:       {position:'absolute',bottom:220,right:16,gap:10},
  mapBtn:        {backgroundColor:'rgba(15,10,0,0.9)',borderRadius:28,width:52,height:52,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:C.border},
  fBadge:        {position:'absolute',top:-4,right:-4,backgroundColor:C.red,borderRadius:9,width:18,height:18,alignItems:'center',justifyContent:'center'},
  fBadgeT:       {color:C.white,fontSize:10,fontWeight:'900'},

  pubSheet:      {position:'absolute',bottom:0,left:0,right:0,backgroundColor:C.bgCard,borderTopLeftRadius:24,borderTopRightRadius:24,padding:20,borderWidth:1,borderBottomWidth:0,borderColor:C.border},
  sheetHandle:   {width:40,height:4,backgroundColor:C.border,borderRadius:2,alignSelf:'center',marginBottom:14},
  pubSheetName:  {color:C.cream,fontSize:20,fontWeight:'800'},
  pubSheetType:  {color:C.amber,fontSize:13,marginTop:2},

  // Chips/Badges
  chip:     {borderWidth:1,borderRadius:20,paddingHorizontal:10,paddingVertical:4,marginRight:6,marginBottom:4,flexDirection:'row',alignItems:'center'},
  chipText: {fontSize:12,fontWeight:'600'},

  // Filter chips
  fChip:   {paddingHorizontal:14,paddingVertical:8,borderRadius:20,borderWidth:1,borderColor:C.border,marginBottom:8},
  fChipOn: {backgroundColor:C.amber,borderColor:C.amber},
  fChipT:  {color:C.creamDim,fontWeight:'600',fontSize:13},
  fChipTOn:{color:C.bg},

  // Modal
  modalOverlay:{flex:1,backgroundColor:'rgba(0,0,0,0.75)',justifyContent:'flex-end'},
  modalCard:   {backgroundColor:C.bgCard,borderTopLeftRadius:24,borderTopRightRadius:24,padding:20,maxHeight:SH*0.88,borderWidth:1,borderBottomWidth:0,borderColor:C.border},
  modalHeader: {flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginBottom:8},
  modalTitle:  {color:C.amber,fontSize:18,fontWeight:'800'},

  // Log modal
  qText:   {color:C.cream,fontSize:16,fontWeight:'700',marginBottom:12},
  ansBtn:  {flexDirection:'row',alignItems:'center',gap:10,padding:14,borderRadius:12,borderWidth:1,borderColor:C.border,marginBottom:8},
  ansBtnOn:{borderColor:C.amber,backgroundColor:'#221200'},
  ansT:    {color:C.creamDim,fontSize:15,flex:1},
  photoAdd:{width:70,height:70,borderRadius:8,borderWidth:1,borderColor:C.border,alignItems:'center',justifyContent:'center',borderStyle:'dashed'},

  // Pub detail
  noteBox: {flexDirection:'row',alignItems:'flex-start',gap:6,backgroundColor:'#1F1000',borderRadius:10,padding:10,marginVertical:6,borderLeftWidth:3,borderLeftColor:C.gold},
  expandOverlay:{position:'absolute',bottom:4,right:12,backgroundColor:'rgba(0,0,0,0.5)',borderRadius:6,padding:3},
  reviewCard:{backgroundColor:C.bgCardAlt,borderRadius:12,padding:12,marginBottom:8,borderWidth:1,borderColor:C.border},
  reviewUser:{color:C.cream,fontWeight:'700',fontSize:14},
  reviewNote:{color:C.creamDim,fontSize:13,fontStyle:'italic',marginTop:4},
  poiRow:{flexDirection:'row',alignItems:'center',gap:10,backgroundColor:C.bgCardAlt,borderRadius:12,padding:10,marginBottom:8,borderWidth:1,borderColor:C.border},
  poiIconWrap:{width:32,height:32,borderRadius:16,alignItems:'center',justifyContent:'center'},
  poiName:{color:C.cream,fontWeight:'700',fontSize:14},
  transportSummary:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:8},
  transportSummaryItem:{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:C.bgCardAlt,borderRadius:16,paddingHorizontal:10,paddingVertical:6,borderWidth:1,borderColor:C.border},
  transportSummaryText:{color:C.cream,fontSize:12,fontWeight:'700'},
  poiToast:{position:'absolute',left:16,right:16,bottom:230,backgroundColor:'rgba(15,10,0,0.96)',borderRadius:14,padding:12,borderWidth:1,borderColor:C.border,flexDirection:'row',alignItems:'center',gap:10},

  // Layer modal
  layerRow:   {flexDirection:'row',alignItems:'center',gap:8,paddingVertical:14,borderBottomWidth:1,borderBottomColor:C.border},
  layerLabel: {color:C.cream,fontWeight:'700',fontSize:15},

  // Photo viewer
  pvBg:    {flex:1,backgroundColor:'rgba(0,0,0,0.96)',justifyContent:'center',alignItems:'center'},
  pvImg:   {width:SW,height:SH*0.72},
  pvClose: {position:'absolute',top:50,right:20,backgroundColor:'rgba(0,0,0,0.6)',borderRadius:22,padding:8},
  pvNav:   {flexDirection:'row',alignItems:'center',gap:20,marginTop:16},
  pvBtn:   {backgroundColor:'rgba(255,255,255,0.1)',borderRadius:24,padding:8},
  pvBtnOff:{opacity:0.3},
  pvCount: {color:C.cream,fontWeight:'700',fontSize:15},
  pvAuthor:{color:C.creamDim,fontSize:13,marginTop:8},
  pvFooter: {position:'absolute',bottom:30,left:0,right:0,flexDirection:'row',justifyContent:'space-between',paddingHorizontal:20,alignItems:'center'},
  pvLikeCount: {color:C.white,fontSize:14,fontWeight:'600'},

  // Page headers
  pageHdr:  {paddingTop:52,paddingHorizontal:20,paddingBottom:12,backgroundColor:C.bg},
  pageTitle:{color:C.amber,fontSize:28,fontWeight:'900',letterSpacing:0.5},
  pageSub:  {color:C.creamDim,fontSize:14,marginTop:2},

  // Sort bar
  sortBar:  {flexDirection:'row',paddingHorizontal:16,marginBottom:12,gap:8,flexWrap:'wrap'},
  sortBtn:  {paddingHorizontal:14,paddingVertical:7,borderRadius:20,borderWidth:1,borderColor:C.border},
  sortBtnOn:{backgroundColor:C.amber,borderColor:C.amber},
  sortBtnT: {color:C.creamDim,fontSize:13,fontWeight:'600'},
  sortBtnTOn:{color:C.bg},

  // Stats
  statsRow:  {flexDirection:'row',marginHorizontal:16,marginBottom:12,gap:8},
  statBox:   {flex:1,backgroundColor:C.bgCard,borderRadius:14,padding:12,alignItems:'center',borderWidth:1,borderColor:C.border},
  statNum:   {color:C.amber,fontSize:22,fontWeight:'900'},
  statLabel: {color:C.creamDim,fontSize:11,marginTop:2,textAlign:'center'},
  statsGrid: {flexDirection:'row',flexWrap:'wrap',margin:16,gap:10},
  statsGridItem:{flex:1,minWidth:'45%',backgroundColor:C.bgCard,borderRadius:16,padding:14,alignItems:'center',borderWidth:1,borderColor:C.border},
  statsGridNum: {fontSize:26,fontWeight:'900'},
  statsGridLabel:{color:C.creamDim,fontSize:12,marginTop:2},

  // Visits
  visitCard:  {backgroundColor:C.bgCard,borderRadius:16,padding:14,marginBottom:10,borderWidth:1,borderColor:C.border},
  visitIcon:  {width:44,height:44,borderRadius:22,backgroundColor:C.bgCardAlt,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:C.border},
  visitName:  {color:C.cream,fontSize:16,fontWeight:'700'},
  visitType:  {color:C.amber,fontSize:12,marginBottom:4},
  visitNote:  {color:C.creamDim,fontSize:13,fontStyle:'italic',marginTop:8,paddingTop:8,borderTopWidth:1,borderTopColor:C.border},

  // Challenges
  chCard:    {backgroundColor:C.bgCard,borderRadius:16,padding:14,marginBottom:10,borderWidth:1,borderColor:C.border},
  chIconBox: {width:48,height:48,borderRadius:14,alignItems:'center',justifyContent:'center'},
  chName:    {color:C.cream,fontSize:15,fontWeight:'700'},
  chDesc:    {color:C.creamDim,fontSize:13,marginTop:2},
  progTrack: {height:6,backgroundColor:C.bgCardAlt,borderRadius:3,overflow:'hidden',marginBottom:6},
  progBar:   {height:6,borderRadius:3},

  // Leaderboard
  lbRow:   {flexDirection:'row',alignItems:'center',backgroundColor:C.bgCard,borderRadius:14,padding:12,marginBottom:8,borderWidth:1,borderColor:C.border},
  lbRowMe: {borderColor:C.amber,backgroundColor:'#1F1200'},
  lbRank:  {fontSize:20,width:34,textAlign:'center'},
  lbName:  {color:C.cream,fontWeight:'700',fontSize:15},
  lbVal:   {color:C.creamDim,fontWeight:'800',fontSize:18},

  // Community sub-tabs
  subTab:  {flexDirection:'row',alignItems:'center',gap:6,paddingHorizontal:14,paddingVertical:8,borderRadius:20,borderWidth:1,borderColor:C.border},
  subTabOn:{backgroundColor:C.amber,borderColor:C.amber},
  subTabT: {color:C.creamDim,fontWeight:'700',fontSize:13},
  subTabTOn:{color:C.bg},

  // Chat
  chatInput: {flexDirection:'row',gap:8,padding:12,borderTopWidth:1,borderTopColor:C.border,backgroundColor:C.bg},
  msgRow:    {flexDirection:'row',alignItems:'flex-end',marginBottom:10},
  msgBubble: {backgroundColor:C.bgCard,borderRadius:16,padding:10,borderWidth:1,borderColor:C.border},
  msgBubbleMe:{backgroundColor:C.amber},
  msgText:   {color:C.cream,fontSize:14},

  // Profile
  profileCard:{margin:16,backgroundColor:C.bgCard,borderRadius:20,padding:20,alignItems:'center',borderWidth:1,borderColor:C.border},
  avatarEdit: {position:'absolute',bottom:0,right:0,backgroundColor:C.amber,borderRadius:12,padding:4},
  avatarDel:  {position:'absolute',top:0,right:-2,backgroundColor:C.red,borderRadius:10,padding:3},
  profileName:{color:C.cream,fontSize:22,fontWeight:'900'},
  bioText:    {color:C.creamDim,fontSize:14,textAlign:'center',fontStyle:'italic'},
  offBanner:  {margin:16,backgroundColor:'#1A1200',borderRadius:14,padding:12,flexDirection:'row',alignItems:'center',gap:10,borderWidth:1,borderColor:C.amber},
  syncBtn:    {backgroundColor:C.amber,borderRadius:10,paddingHorizontal:12,paddingVertical:6},
  settRow:    {flexDirection:'row',alignItems:'center',gap:10,paddingVertical:14,borderBottomWidth:1,borderBottomColor:C.border},

  // Misc
  secLabel:  {color:C.amber,fontSize:15,fontWeight:'700',marginBottom:10},
  dimText:   {color:C.creamDim,fontSize:13},
  empty:     {alignItems:'center',marginTop:80},
  emptyT:    {color:C.cream,fontSize:18,fontWeight:'700',marginTop:12},
  emptySub:  {color:C.creamDim,fontSize:14,marginTop:6,textAlign:'center'},

  // Follow stats
  followStatBox: {alignItems:'center',minWidth:70,padding:8,backgroundColor:'rgba(255,255,255,0.04)',borderRadius:12,borderWidth:1,borderColor:'rgba(255,255,255,0.08)'},
  followStatNum:  {fontSize:20,fontWeight:'900'},
  followStatLabel:{color:'rgba(255,255,255,0.6)',fontSize:11,marginTop:2},

  // Tab bar
  tabBar:   {flexDirection:'row',backgroundColor:C.tabBar,borderTopWidth:1,borderTopColor:C.border,paddingBottom:Platform.OS==='ios'?24:8,paddingTop:8},
  tabItem:  {flex:1,alignItems:'center',position:'relative',paddingVertical:4},
  tabLabel: {fontSize:9,marginTop:3,fontWeight:'600'},
  tabDot:   {position:'absolute',bottom:-2,width:4,height:4,borderRadius:2,backgroundColor:C.amber},

  // Disabled odkliknutí
  btnDis:   {borderWidth:1,borderColor:'#444',borderRadius:14,paddingVertical:13,alignItems:'center',flexDirection:'row',justifyContent:'center',gap:8,backgroundColor:'#1A1A1A'},
  btnDisT:  {color:'#777',fontWeight:'700',fontSize:14},

  // Offline oblasti
  areaRow:  {flexDirection:'row',alignItems:'center',gap:10,paddingVertical:12,borderBottomWidth:1,borderBottomColor:C.border},
  areaFlag: {fontSize:26},
  areaName: {color:C.cream,fontWeight:'700',fontSize:15},
  areaDlBtn:{backgroundColor:C.amber,borderRadius:10,paddingHorizontal:12,paddingVertical:7,flexDirection:'row',alignItems:'center',gap:5},
  areaDlT:  {color:C.bg,fontSize:12,fontWeight:'800'},

  // Suggest mode hint
  suggestHint:{position:'absolute',top:54,left:70,right:70,backgroundColor:'rgba(15,10,0,0.94)',borderRadius:12,padding:10,flexDirection:'row',alignItems:'center',gap:8,borderWidth:1,borderColor:C.amber},

  // Gallery likes
  photoLikeBtn:{position:'absolute',bottom:4,right:4,backgroundColor:'rgba(0,0,0,0.55)',borderRadius:12,paddingHorizontal:5,paddingVertical:3,flexDirection:'row',alignItems:'center',gap:3},
  photoLikeT:  {color:C.white,fontSize:10,fontWeight:'700'},
  photoLikeBtnMini:{position:'absolute',bottom:4,right:4,backgroundColor:'rgba(0,0,0,0.55)',borderRadius:8,paddingHorizontal:4,paddingVertical:2,flexDirection:'row',alignItems:'center',gap:2},

  // Area warning banner
  areaWarning: {position:'absolute',top:100,left:16,right:16,backgroundColor:C.bgCard,borderRadius:12,padding:10,flexDirection:'row',alignItems:'center',gap:8,borderWidth:1,borderColor:C.amber, shadowColor:'#000',shadowOffset:{width:0,height:2},shadowOpacity:0.3,shadowRadius:3,elevation:3},
  areaWarningText: {color:C.cream,fontSize:12,fontWeight:'600',flex:1},

  // Mock overlay
  mockOverlay: {flex:1,backgroundColor:C.bg,alignItems:'center',justifyContent:'center',padding:36,overflow:'hidden'},
  mockIconWrap: {width:100,height:100,borderRadius:50,backgroundColor:'rgba(200,40,40,0.15)',alignItems:'center',justifyContent:'center',marginBottom:8,borderWidth:1,borderColor:'rgba(200,40,40,0.35)'},
  mockTitle: {color:C.red,fontSize:24,fontWeight:'900',marginTop:8,marginBottom:12,letterSpacing:0.3},
  mockText: {color:C.creamDim,fontSize:15,textAlign:'center',marginBottom:28,lineHeight:22},
  mockAdminBanner: {position:'absolute',top:0,left:0,right:0,backgroundColor:C.amber,flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:16,paddingVertical:8,gap:8,zIndex:999},
  mockAdminBannerT: {color:C.bg,fontSize:13,fontWeight:'700',flex:1},
});