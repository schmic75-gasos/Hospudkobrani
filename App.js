import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  Alert, Modal, Image, ActivityIndicator, FlatList, Dimensions,
  Platform, StatusBar, Animated, KeyboardAvoidingView, RefreshControl,
  Switch, Pressable, SafeAreaView
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import MapView, { Marker, UrlTile, PROVIDER_DEFAULT } from 'react-native-maps';
import { Ionicons, MaterialCommunityIcons, FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import NetInfo from '@react-native-community/netinfo';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const API_BASE = 'https://fluffini.cz/api';

// ─── THEME ────────────────────────────────────────────────────────────────────
const C = {
  bg:        '#0F0A00',
  bgCard:    '#1A1200',
  bgCardAlt: '#221900',
  amber:     '#F5A623',
  amberDark: '#C07D10',
  amberGlow: '#FFD070',
  gold:      '#D4A017',
  cream:     '#F5ECD7',
  creamDim:  '#A89070',
  red:       '#C0392B',
  green:     '#27AE60',
  blue:      '#2980B9',
  border:    '#3D2800',
  borderGlow:'#7A5000',
  shadow:    '#000000',
  white:     '#FFFFFF',
  tabBar:    '#130D00',
  star:      '#FFD700',
};

// ─── API HELPERS ──────────────────────────────────────────────────────────────
const getToken = async () => AsyncStorage.getItem('auth_token');

const apiFetch = async (endpoint, options = {}) => {
  const token = await getToken();
  const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers: { ...headers, ...options.headers } });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Chyba serveru' }));
    throw new Error(err.message || 'Chyba serveru');
  }
  return res.json();
};

// ─── CACHE ────────────────────────────────────────────────────────────────────
const CACHE_TTL = 5 * 60 * 1000; // 5 min
const memCache = {};

const cached = async (key, fetcher, ttl = CACHE_TTL) => {
  const now = Date.now();
  if (memCache[key] && now - memCache[key].ts < ttl) return memCache[key].data;
  try {
    const stored = await AsyncStorage.getItem(`cache_${key}`);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (now - parsed.ts < ttl) { memCache[key] = parsed; return parsed.data; }
    }
  } catch {}
  const data = await fetcher();
  const entry = { data, ts: now };
  memCache[key] = entry;
  AsyncStorage.setItem(`cache_${key}`, JSON.stringify(entry)).catch(() => {});
  return data;
};

const invalidateCache = (key) => {
  delete memCache[key];
  AsyncStorage.removeItem(`cache_${key}`).catch(() => {});
};

// ─── OFFLINE QUEUE ────────────────────────────────────────────────────────────
const getOfflineQueue = async () => {
  const raw = await AsyncStorage.getItem('offline_queue');
  return raw ? JSON.parse(raw) : [];
};
const addToOfflineQueue = async (item) => {
  const q = await getOfflineQueue();
  q.push({ ...item, queuedAt: new Date().toISOString() });
  await AsyncStorage.setItem('offline_queue', JSON.stringify(q));
};
const clearOfflineQueue = async () => AsyncStorage.removeItem('offline_queue');

// ─── DISTANCE ─────────────────────────────────────────────────────────────────
const haversine = (lat1, lon1, lat2, lon2) => {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

// ─── STARS ────────────────────────────────────────────────────────────────────
const Stars = ({ rating, size = 14, interactive = false, onRate }) => (
  <View style={{ flexDirection: 'row', gap: 2 }}>
    {[1,2,3,4,5].map(i => (
      <TouchableOpacity key={i} disabled={!interactive} onPress={() => onRate?.(i)} activeOpacity={0.7}>
        <Ionicons name={i <= rating ? 'star' : 'star-outline'} size={size} color={C.star} />
      </TouchableOpacity>
    ))}
  </View>
);

// ─── BADGE ────────────────────────────────────────────────────────────────────
const Badge = ({ label, color = C.amber }) => (
  <View style={[s.badge, { borderColor: color }]}>
    <Text style={[s.badgeText, { color }]}>{label}</Text>
  </View>
);

// ─── BEER ICON ────────────────────────────────────────────────────────────────
const BeerMarker = ({ visited, size = 36 }) => (
  <View style={[s.marker, visited && s.markerVisited, { width: size, height: size, borderRadius: size/2 }]}>
    <Text style={{ fontSize: size * 0.55 }}>🍺</Text>
  </View>
);

// ══════════════════════════════════════════════════════════════════════════════
// AUTH SCREEN
// ══════════════════════════════════════════════════════════════════════════════
const AuthScreen = ({ onLogin }) => {
  const [mode, setMode] = useState('login'); // login | register
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 800, useNativeDriver: true }).start();
  }, []);

  const submit = async () => {
    if (!email || !password || (mode === 'register' && !username)) {
      Alert.alert('Chybí údaje', 'Vyplň prosím všechna pole.'); return;
    }
    setLoading(true);
    try {
      const endpoint = mode === 'login' ? '/auth/login' : '/auth/register';
      const body = mode === 'login' ? { email, password } : { email, password, username };
      const data = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
      await AsyncStorage.setItem('auth_token', data.token);
      await AsyncStorage.setItem('user_data', JSON.stringify(data.user));
      onLogin(data.user);
    } catch (e) {
      Alert.alert('Chyba', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <LinearGradient colors={[C.bg, '#1A0F00', C.bg]} style={s.authBg}>
        <Animated.View style={[s.authContainer, { opacity: fadeAnim }]}>
          <Text style={s.authLogo}>🍺</Text>
          <Text style={s.authTitle}>Hospůdkobraní</Text>
          <Text style={s.authSub}>Sbírej hospůdky po celém Česku</Text>

          <View style={s.authCard}>
            <View style={s.authTabs}>
              {['login','register'].map(m => (
                <TouchableOpacity key={m} style={[s.authTab, mode===m && s.authTabActive]} onPress={() => setMode(m)}>
                  <Text style={[s.authTabText, mode===m && s.authTabTextActive]}>
                    {m === 'login' ? 'Přihlášení' : 'Registrace'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {mode === 'register' && (
              <TextInput style={s.input} placeholder="Přezdívka (nick)" placeholderTextColor={C.creamDim}
                value={username} onChangeText={setUsername} autoCapitalize="none" />
            )}
            <TextInput style={s.input} placeholder="E-mail" placeholderTextColor={C.creamDim}
              value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            <TextInput style={s.input} placeholder="Heslo" placeholderTextColor={C.creamDim}
              value={password} onChangeText={setPassword} secureTextEntry />

            <TouchableOpacity style={s.btnPrimary} onPress={submit} disabled={loading}>
              {loading ? <ActivityIndicator color={C.bg} /> :
                <Text style={s.btnPrimaryText}>{mode === 'login' ? 'Vstoupit do hospody' : 'Zaregistrovat se'}</Text>}
            </TouchableOpacity>
          </View>

          <Text style={s.authFooter}>🍻 Pij s rozumem, sbírej bez hranic</Text>
        </Animated.View>
      </LinearGradient>
    </View>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// MAP SCREEN
// ══════════════════════════════════════════════════════════════════════════════
const MapScreen = ({ user }) => {
  const mapRef = useRef(null);
  const [pubs, setPubs] = useState([]);
  const [visitedIds, setVisitedIds] = useState(new Set());
  const [location, setLocation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedPub, setSelectedPub] = useState(null);
  const [detailModal, setDetailModal] = useState(false);
  const [logModal, setLogModal] = useState(false);
  const slideAnim = useRef(new Animated.Value(300)).current;

  useEffect(() => { loadData(); setupLocation(); }, []);

  const loadData = async () => {
    try {
      const [pubsData, visitsData] = await Promise.all([
        cached('pubs_all', () => apiFetch('/pubs'), 10 * 60 * 1000),
        cached(`visits_${user.id}`, () => apiFetch('/visits/my'), CACHE_TTL),
      ]);
      setPubs(pubsData);
      setVisitedIds(new Set(visitsData.map(v => v.pub_id)));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const setupLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    setLocation(loc.coords);
    mapRef.current?.animateToRegion({
      latitude: loc.coords.latitude, longitude: loc.coords.longitude,
      latitudeDelta: 0.02, longitudeDelta: 0.02,
    }, 1000);
    Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 10 },
      l => setLocation(l.coords));
  };

  const centerOnMe = () => {
    if (!location) { Alert.alert('Poloha', 'Poloha není dostupná'); return; }
    mapRef.current?.animateToRegion({
      latitude: location.latitude, longitude: location.longitude,
      latitudeDelta: 0.01, longitudeDelta: 0.01,
    }, 800);
  };

  const openPub = (pub) => {
    setSelectedPub(pub);
    setDetailModal(true);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 100 }).start();
  };

  const closeDetail = () => {
    Animated.timing(slideAnim, { toValue: 300, duration: 200, useNativeDriver: true }).start(() => {
      setDetailModal(false); setSelectedPub(null);
    });
  };

  const tryLog = (pub) => {
    if (!location) { Alert.alert('Poloha potřebná', 'Zapni GPS polohu.'); return; }
    const dist = haversine(location.latitude, location.longitude, pub.latitude, pub.longitude);
    if (dist > 25) {
      Alert.alert('Příliš daleko', `Jsi ${Math.round(dist)} m od hospůdky. Musíš být do 25 m.`); return;
    }
    setLogModal(true);
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={C.amber} size="large" /></View>;

  return (
    <View style={{ flex: 1 }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={null}
        initialRegion={{ latitude: 49.7384, longitude: 13.3736, latitudeDelta: 0.1, longitudeDelta: 0.1 }}
        rotateEnabled={false}
        showsUserLocation={true}
        showsMyLocationButton={false}
        mapType="none"
      >
        {/* OpenStreetMap tiles – zdarma, bez API klíče */}
        <UrlTile
          urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maximumZ={19}
          flipY={false}
          tileSize={256}
          shouldReplaceMapContent={true}
          zIndex={-1}
        />
        {pubs.map(pub => (
          <Marker key={pub.id} coordinate={{ latitude: pub.latitude, longitude: pub.longitude }}
            onPress={() => openPub(pub)} tracksViewChanges={false}>
            <BeerMarker visited={visitedIds.has(pub.id)} size={visitedIds.has(pub.id) ? 44 : 36} />
          </Marker>
        ))}
      </MapView>

      {/* HUD */}
      <View style={s.mapHud}>
        <View style={s.mapHudBox}>
          <Text style={s.mapHudNum}>{visitedIds.size}</Text>
          <Text style={s.mapHudLabel}>navštíveno</Text>
        </View>
        <View style={[s.mapHudBox, { borderColor: C.border }]}>
          <Text style={s.mapHudNum}>{pubs.length}</Text>
          <Text style={s.mapHudLabel}>celkem</Text>
        </View>
      </View>

      <TouchableOpacity style={s.gpsBtn} onPress={centerOnMe}>
        <Ionicons name="locate" size={22} color={C.amber} />
      </TouchableOpacity>

      {/* PUB DETAIL BOTTOM SHEET */}
      {detailModal && selectedPub && (
        <Animated.View style={[s.pubSheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={s.pubSheetHandle} />
          <View style={s.pubSheetRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.pubSheetName}>{selectedPub.name}</Text>
              <Text style={s.pubSheetType}>{selectedPub.type}</Text>
              {selectedPub.avg_rating > 0 && (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Stars rating={Math.round(selectedPub.avg_rating)} size={12} />
                  <Text style={s.ratingText}>({selectedPub.avg_rating?.toFixed(1)})</Text>
                </View>
              )}
            </View>
            <TouchableOpacity onPress={closeDetail} style={s.closeBtn}>
              <Ionicons name="close" size={20} color={C.creamDim} />
            </TouchableOpacity>
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
            {selectedPub.beers?.split(',').map(b => b.trim()).filter(Boolean).map((b, i) => (
              <Badge key={i} label={`🍺 ${b}`} color={C.amber} />
            ))}
            {selectedPub.card_payment && <Badge label="💳 Karty" color={C.green} />}
            {selectedPub.note && <Badge label="⚠️ Poznámka" color={C.gold} />}
          </ScrollView>

          <Text style={s.pubSheetMeta}>
            {selectedPub.opening_hours ? `🕐 ${selectedPub.opening_hours}` : ''}
          </Text>

          <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            {visitedIds.has(selectedPub.id) ? (
              <View style={[s.btnSuccess, { flex: 1 }]}>
                <Ionicons name="checkmark-circle" size={18} color={C.green} />
                <Text style={[s.btnPrimaryText, { color: C.green }]}>Odkliknuto!</Text>
              </View>
            ) : (
              <TouchableOpacity style={[s.btnPrimary, { flex: 1 }]} onPress={() => tryLog(selectedPub)}>
                <Text style={s.btnPrimaryText}>🍻 Odkliknout hospůdku</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={s.btnSecondary}
              onPress={() => { closeDetail(); setTimeout(() => setDetailModal(true), 50); }}>
              <Ionicons name="information-circle" size={20} color={C.amber} />
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {/* LOG MODAL */}
      {logModal && selectedPub && (
        <LogModal pub={selectedPub} user={user} onClose={() => setLogModal(false)}
          onSuccess={() => {
            setVisitedIds(prev => new Set([...prev, selectedPub.id]));
            invalidateCache(`visits_${user.id}`);
            setLogModal(false);
            closeDetail();
          }} />
      )}
    </View>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// LOG MODAL – otázka + hodnocení + foto
// ══════════════════════════════════════════════════════════════════════════════
const LogModal = ({ pub, user, onClose, onSuccess }) => {
  const [step, setStep] = useState('question'); // question | rating
  const [question, setQuestion] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [rating, setRating] = useState(0);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    loadQuestion();
    NetInfo.fetch().then(s => setIsOnline(s.isConnected));
  }, []);

  const loadQuestion = async () => {
    try {
      const q = await apiFetch(`/pubs/${pub.id}/question`);
      setQuestion(q);
    } catch { setQuestion(null); }
    finally { setLoading(false); }
  };

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7, allowsMultipleSelection: false });
    if (!res.canceled) setPhotos(prev => [...prev, res.assets[0].uri]);
  };

  const submitLog = async () => {
    if (question && !selectedAnswer) { Alert.alert('Odpověz na otázku!'); return; }
    if (rating === 0) { Alert.alert('Dej hodnocení!'); return; }
    setSubmitting(true);

    const payload = {
      pub_id: pub.id,
      answer_id: selectedAnswer,
      rating,
      note,
      logged_at: new Date().toISOString(),
      photos: photos.length,
    };

    try {
      if (isOnline) {
        await apiFetch('/visits', { method: 'POST', body: JSON.stringify(payload) });
        // Upload photos
        for (const uri of photos) {
          const fd = new FormData();
          fd.append('photo', { uri, name: 'photo.jpg', type: 'image/jpeg' });
          fd.append('pub_id', pub.id);
          await fetch(`${API_BASE}/visits/photo`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${await getToken()}` },
            body: fd,
          });
        }
      } else {
        await addToOfflineQueue({ type: 'visit', payload, photos });
        Alert.alert('Offline mód', 'Odkliknutí uloženo lokálně. Synchronizuje se po připojení k síti. 📶');
      }
      onSuccess();
    } catch (e) {
      Alert.alert('Chyba', e.message);
    } finally { setSubmitting(false); }
  };

  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ width: '100%' }}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{step === 'question' ? '🔍 Ověření' : '⭐ Hodnocení'}</Text>
              <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim} /></TouchableOpacity>
            </View>
            <Text style={s.modalPubName}>{pub.name}</Text>

            {loading ? <ActivityIndicator color={C.amber} style={{ margin: 20 }} /> : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {step === 'question' && question && (
                  <View>
                    <Text style={s.questionText}>{question.question_text}</Text>
                    {question.answers.map(ans => (
                      <TouchableOpacity key={ans.id}
                        style={[s.answerBtn, selectedAnswer === ans.id && s.answerBtnActive]}
                        onPress={() => setSelectedAnswer(ans.id)}>
                        {selectedAnswer === ans.id && <Ionicons name="radio-button-on" size={16} color={C.amber} />}
                        {selectedAnswer !== ans.id && <Ionicons name="radio-button-off" size={16} color={C.creamDim} />}
                        <Text style={[s.answerText, selectedAnswer === ans.id && s.answerTextActive]}>
                          {ans.answer_text}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity style={s.btnPrimary} onPress={() => {
                      if (!selectedAnswer) { Alert.alert('Vyber odpověď!'); return; }
                      setStep('rating');
                    }}>
                      <Text style={s.btnPrimaryText}>Pokračovat →</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {(step === 'rating' || !question) && (
                  <View>
                    <Text style={s.sectionLabel}>Tvoje hodnocení</Text>
                    <View style={s.starsRow}>
                      <Stars rating={rating} size={36} interactive onRate={setRating} />
                    </View>
                    <Text style={s.sectionLabel}>Poznámka (volitelné)</Text>
                    <TextInput style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
                      placeholder="Jak ses měl(a)?" placeholderTextColor={C.creamDim}
                      value={note} onChangeText={setNote} multiline />

                    <Text style={s.sectionLabel}>Fotky (volitelné)</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {photos.map((uri, i) => (
                        <View key={i} style={s.photoThumb}>
                          <Image source={{ uri }} style={{ width: 70, height: 70, borderRadius: 8 }} />
                          <TouchableOpacity style={s.photoRemove} onPress={() => setPhotos(p => p.filter((_,j)=>j!==i))}>
                            <Ionicons name="close-circle" size={18} color={C.red} />
                          </TouchableOpacity>
                        </View>
                      ))}
                      <TouchableOpacity style={s.photoAdd} onPress={pickPhoto}>
                        <Ionicons name="camera" size={24} color={C.amber} />
                      </TouchableOpacity>
                    </ScrollView>

                    <TouchableOpacity style={[s.btnPrimary, { marginTop: 16 }]} onPress={submitLog} disabled={submitting}>
                      {submitting ? <ActivityIndicator color={C.bg} /> :
                        <Text style={s.btnPrimaryText}>🍺 Potvrdit odkliknutí!</Text>}
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
// VISITS SCREEN – moje hospůdky
// ══════════════════════════════════════════════════════════════════════════════
const VisitsScreen = ({ user }) => {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState('date'); // date | rating | name

  useEffect(() => { loadVisits(); }, []);

  const loadVisits = async (force = false) => {
    if (force) invalidateCache(`visits_detail_${user.id}`);
    try {
      const data = await cached(`visits_detail_${user.id}`, () => apiFetch('/visits/my?detail=1'), CACHE_TTL);
      setVisits(data);
    } catch {}
    setLoading(false); setRefreshing(false);
  };

  const sorted = useMemo(() => {
    const v = [...visits];
    if (sortBy === 'date') return v.sort((a,b) => new Date(b.logged_at) - new Date(a.logged_at));
    if (sortBy === 'rating') return v.sort((a,b) => b.rating - a.rating);
    if (sortBy === 'name') return v.sort((a,b) => a.pub_name.localeCompare(b.pub_name));
    return v;
  }, [visits, sortBy]);

  const renderVisit = ({ item }) => (
    <View style={s.visitCard}>
      <View style={s.visitCardRow}>
        <Text style={s.visitCardEmoji}>🍺</Text>
        <View style={{ flex: 1 }}>
          <Text style={s.visitCardName}>{item.pub_name}</Text>
          <Text style={s.visitCardType}>{item.pub_type}</Text>
          <Stars rating={item.rating} size={13} />
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.visitCardDate}>{new Date(item.logged_at).toLocaleDateString('cs-CZ')}</Text>
          <Text style={s.visitCardTime}>{new Date(item.logged_at).toLocaleTimeString('cs-CZ', { hour:'2-digit', minute:'2-digit' })}</Text>
        </View>
      </View>
      {item.note ? <Text style={s.visitCardNote}>"{item.note}"</Text> : null}
    </View>
  );

  if (loading) return <View style={s.center}><ActivityIndicator color={C.amber} size="large" /></View>;

  return (
    <View style={[s.screen]}>
      <View style={s.pageHeader}>
        <Text style={s.pageTitle}>Moje hospůdky</Text>
        <Text style={s.pageSubtitle}>{visits.length} navštívených 🏆</Text>
      </View>

      {/* Sort bar */}
      <View style={s.sortBar}>
        {[['date','Datum'],['rating','Hodnocení'],['name','Název']].map(([k,l]) => (
          <TouchableOpacity key={k} style={[s.sortBtn, sortBy===k && s.sortBtnActive]} onPress={() => setSortBy(k)}>
            <Text style={[s.sortBtnText, sortBy===k && s.sortBtnTextActive]}>{l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Stats bar */}
      {visits.length > 0 && (
        <View style={s.statsRow}>
          <View style={s.statBox}>
            <Text style={s.statNum}>{(visits.reduce((a,v)=>a+v.rating,0)/visits.length).toFixed(1)}</Text>
            <Text style={s.statLabel}>prům. hodnocení</Text>
          </View>
          <View style={s.statBox}>
            <Text style={s.statNum}>{Math.max(...visits.map(v=>v.rating))}</Text>
            <Text style={s.statLabel}>nejlepší</Text>
          </View>
          <View style={s.statBox}>
            <Text style={s.statNum}>{visits.filter(v=>v.rating>=4).length}</Text>
            <Text style={s.statLabel}>oblíbených</Text>
          </View>
        </View>
      )}

      <FlatList data={sorted} keyExtractor={i=>String(i.id)} renderItem={renderVisit}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadVisits(true); }}
          tintColor={C.amber} colors={[C.amber]} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyEmoji}>🍺</Text>
            <Text style={s.emptyText}>Zatím žádné hospůdky</Text>
            <Text style={s.emptySubtext}>Jdi na mapu a odklikni svoji první!</Text>
          </View>
        }
      />
    </View>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// CHALLENGES SCREEN
// ══════════════════════════════════════════════════════════════════════════════
const ChallengesScreen = ({ user }) => {
  const [challenges, setChallenges] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadChallenges(); }, []);

  const loadChallenges = async () => {
    try {
      const data = await cached(`challenges_${user.id}`, () => apiFetch('/challenges/my'), 2 * 60 * 1000);
      setChallenges(data);
    } catch {}
    setLoading(false);
  };

  const renderChallenge = ({ item }) => {
    const pct = Math.min(1, item.progress / item.target);
    const done = pct >= 1;
    return (
      <View style={[s.challengeCard, done && s.challengeCardDone]}>
        <View style={s.challengeRow}>
          <Text style={s.challengeIcon}>{item.icon || '🎯'}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.challengeName}>{item.name}</Text>
            <Text style={s.challengeDesc}>{item.description}</Text>
          </View>
          {done && <Text style={s.challengeDoneBadge}>✅</Text>}
        </View>
        <View style={s.progressTrack}>
          <View style={[s.progressBar, { width: `${pct * 100}%`, backgroundColor: done ? C.green : C.amber }]} />
        </View>
        <Text style={s.progressText}>{item.progress} / {item.target}
          {item.reward ? ` · 🏅 ${item.reward}` : ''}
        </Text>
      </View>
    );
  };

  if (loading) return <View style={s.center}><ActivityIndicator color={C.amber} size="large" /></View>;

  const done = challenges.filter(c => c.progress >= c.target).length;

  return (
    <View style={s.screen}>
      <View style={s.pageHeader}>
        <Text style={s.pageTitle}>Výzvy</Text>
        <Text style={s.pageSubtitle}>{done}/{challenges.length} splněno 🎯</Text>
      </View>
      <FlatList data={challenges} keyExtractor={i=>String(i.id)} renderItem={renderChallenge}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        ListEmptyComponent={<View style={s.empty}><Text style={s.emptyEmoji}>🎯</Text>
          <Text style={s.emptyText}>Žádné výzvy</Text></View>}
      />
    </View>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// PROFILE SCREEN
// ══════════════════════════════════════════════════════════════════════════════
const ProfileScreen = ({ user, onLogout }) => {
  const [myData, setMyData] = useState(user);
  const [editMode, setEditMode] = useState(false);
  const [bio, setBio] = useState(user.bio || '');
  const [stats, setStats] = useState(null);
  const [searchUser, setSearchUser] = useState('');
  const [foundUser, setFoundUser] = useState(null);
  const [searching, setSearching] = useState(false);
  const [loading, setLoading] = useState(true);
  const [offlineCount, setOfflineCount] = useState(0);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => { loadStats(); checkOffline(); }, []);

  const loadStats = async () => {
    try {
      const data = await cached(`profile_stats_${user.id}`, () => apiFetch('/profile/stats'), CACHE_TTL);
      setStats(data);
    } catch {}
    setLoading(false);
  };

  const checkOffline = async () => {
    const q = await getOfflineQueue();
    setOfflineCount(q.length);
  };

  const syncOffline = async () => {
    setSyncing(true);
    const q = await getOfflineQueue();
    let synced = 0;
    for (const item of q) {
      try {
        if (item.type === 'visit') {
          await apiFetch('/visits', { method: 'POST', body: JSON.stringify(item.payload) });
          synced++;
        }
      } catch {}
    }
    if (synced > 0) {
      await clearOfflineQueue();
      setOfflineCount(0);
      invalidateCache(`visits_${user.id}`);
      invalidateCache(`visits_detail_${user.id}`);
      Alert.alert('Synchronizace', `Synchronizováno ${synced} odkliknutí! 🍺`);
    } else {
      Alert.alert('Synchronizace', 'Nic k synchronizaci.');
    }
    setSyncing(false);
  };

  const pickAvatar = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') return;
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7, allowsEditing: true, aspect: [1,1] });
    if (!res.canceled) {
      const fd = new FormData();
      fd.append('avatar', { uri: res.assets[0].uri, name: 'avatar.jpg', type: 'image/jpeg' });
      try {
        const r = await fetch(`${API_BASE}/profile/avatar`, {
          method: 'POST', headers: { Authorization: `Bearer ${await getToken()}` }, body: fd });
        const d = await r.json();
        setMyData(p => ({ ...p, avatar_url: d.avatar_url }));
        await AsyncStorage.setItem('user_data', JSON.stringify({ ...myData, avatar_url: d.avatar_url }));
      } catch (e) { Alert.alert('Chyba', e.message); }
    }
  };

  const saveBio = async () => {
    try {
      await apiFetch('/profile/bio', { method: 'PUT', body: JSON.stringify({ bio }) });
      setMyData(p => ({ ...p, bio }));
      setEditMode(false);
    } catch (e) { Alert.alert('Chyba', e.message); }
  };

  const findUser = async () => {
    if (!searchUser.trim()) return;
    setSearching(true);
    try {
      const data = await apiFetch(`/users/find?q=${encodeURIComponent(searchUser)}`);
      setFoundUser(data);
    } catch (e) { Alert.alert('Nenalezeno', 'Hospůdkobraník nenalezen.'); setFoundUser(null); }
    setSearching(false);
  };

  const logout = async () => {
    Alert.alert('Odhlásit?', 'Opravdu se chceš odhlásit?', [
      { text: 'Zrušit', style: 'cancel' },
      { text: 'Odhlásit', style: 'destructive', onPress: async () => {
        await AsyncStorage.multiRemove(['auth_token', 'user_data']);
        onLogout();
      }},
    ]);
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 100 }}>
      <View style={s.pageHeader}>
        <Text style={s.pageTitle}>Profil</Text>
      </View>

      {/* Avatar + info */}
      <View style={s.profileCard}>
        <TouchableOpacity onPress={pickAvatar} style={s.avatarWrap}>
          {myData.avatar_url
            ? <Image source={{ uri: myData.avatar_url }} style={s.avatar} />
            : <View style={s.avatarPlaceholder}><Text style={{ fontSize: 40 }}>🍺</Text></View>}
          <View style={s.avatarEdit}><Ionicons name="camera" size={14} color={C.bg} /></View>
        </TouchableOpacity>
        <Text style={s.profileName}>{myData.username}</Text>
        <Text style={s.profileEmail}>{myData.email}</Text>

        {editMode ? (
          <View style={{ width: '100%', marginTop: 10 }}>
            <TextInput style={[s.input, { minHeight: 60 }]} value={bio} onChangeText={setBio}
              placeholder="Napiš něco o sobě..." placeholderTextColor={C.creamDim} multiline />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={[s.btnSecondary, { flex: 1 }]} onPress={() => setEditMode(false)}>
                <Text style={{ color: C.creamDim }}>Zrušit</Text></TouchableOpacity>
              <TouchableOpacity style={[s.btnPrimary, { flex: 1 }]} onPress={saveBio}>
                <Text style={s.btnPrimaryText}>Uložit</Text></TouchableOpacity>
            </View>
          </View>
        ) : (
          <TouchableOpacity onPress={() => setEditMode(true)}>
            <Text style={s.bioText}>{myData.bio || '+ Přidat bio'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Stats */}
      {stats && (
        <View style={s.statsGrid}>
          {[
            ['🍺', stats.total_visits, 'hospůdek'],
            ['⭐', stats.avg_rating?.toFixed(1), 'průměr'],
            ['🏆', stats.challenges_done, 'výzev'],
            ['📅', stats.visits_this_month, 'tento měsíc'],
          ].map(([icon, val, label], i) => (
            <View key={i} style={s.statsGridItem}>
              <Text style={s.statsGridIcon}>{icon}</Text>
              <Text style={s.statsGridNum}>{val ?? '–'}</Text>
              <Text style={s.statsGridLabel}>{label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Offline sync */}
      {offlineCount > 0 && (
        <View style={s.offlineBanner}>
          <Ionicons name="cloud-offline" size={18} color={C.amber} />
          <Text style={s.offlineText}>{offlineCount} odkliknutí čeká na synchronizaci</Text>
          <TouchableOpacity style={s.syncBtn} onPress={syncOffline} disabled={syncing}>
            {syncing ? <ActivityIndicator size="small" color={C.bg} />
              : <Text style={s.syncBtnText}>Sync</Text>}
          </TouchableOpacity>
        </View>
      )}

      {/* Find user */}
      <View style={s.sectionBlock}>
        <Text style={s.sectionLabel}>🔍 Najdi Hospůdkobraníka</Text>
        <View style={s.searchRow}>
          <TextInput style={[s.input, { flex: 1, marginBottom: 0 }]} placeholder="Přezdívka..."
            placeholderTextColor={C.creamDim} value={searchUser} onChangeText={setSearchUser}
            onSubmitEditing={findUser} returnKeyType="search" />
          <TouchableOpacity style={s.searchBtn} onPress={findUser} disabled={searching}>
            {searching ? <ActivityIndicator size="small" color={C.bg} />
              : <Ionicons name="search" size={18} color={C.bg} />}
          </TouchableOpacity>
        </View>

        {foundUser && (
          <View style={s.foundUserCard}>
            <Text style={s.foundUserName}>🍺 {foundUser.username}</Text>
            {foundUser.bio && <Text style={s.foundUserBio}>{foundUser.bio}</Text>}
            <View style={s.foundUserStats}>
              <Text style={s.foundUserStat}>🏠 {foundUser.total_visits} hospůdek</Text>
              <Text style={s.foundUserStat}>⭐ {foundUser.avg_rating?.toFixed(1) ?? '–'}</Text>
            </View>
            <Text style={s.foundUserDate}>Člen od {new Date(foundUser.created_at).toLocaleDateString('cs-CZ')}</Text>
          </View>
        )}
      </View>

      {/* Settings / logout */}
      <View style={s.sectionBlock}>
        <Text style={s.sectionLabel}>⚙️ Nastavení</Text>
        <TouchableOpacity style={s.settingsRow} onPress={logout}>
          <Ionicons name="log-out" size={18} color={C.red} />
          <Text style={[s.settingsRowText, { color: C.red }]}>Odhlásit se</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.versionText}>Hospůdkobraní v1.0 · Made with 🍺 in CZ</Text>
    </ScrollView>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// TAB BAR
// ══════════════════════════════════════════════════════════════════════════════
const TAB_ICONS = {
  map:       { active: 'map',        inactive: 'map-outline',        label: 'Domů' },
  visits:    { active: 'beer',       inactive: 'beer-outline',       label: 'Hospůdky' },
  challenges:{ active: 'trophy',     inactive: 'trophy-outline',     label: 'Výzvy' },
  profile:   { active: 'person',     inactive: 'person-outline',     label: 'Profil' },
};

const TabBar = ({ activeTab, onTab }) => (
  <View style={s.tabBar}>
    {Object.entries(TAB_ICONS).map(([key, cfg]) => {
      const active = activeTab === key;
      return (
        <TouchableOpacity key={key} style={s.tabItem} onPress={() => onTab(key)} activeOpacity={0.7}>
          <Ionicons name={active ? cfg.active : cfg.inactive} size={24} color={active ? C.amber : C.creamDim} />
          <Text style={[s.tabLabel, { color: active ? C.amber : C.creamDim }]}>{cfg.label}</Text>
          {active && <View style={s.tabDot} />}
        </TouchableOpacity>
      );
    })}
  </View>
);

// ══════════════════════════════════════════════════════════════════════════════
// APP ROOT
// ══════════════════════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);
  const [activeTab, setActiveTab] = useState('map');

  useEffect(() => { bootCheck(); }, []);

  const bootCheck = async () => {
    try {
      const [token, userData] = await Promise.all([
        AsyncStorage.getItem('auth_token'),
        AsyncStorage.getItem('user_data'),
      ]);
      if (token && userData) {
        setUser(JSON.parse(userData));
        // Verify token in background
        apiFetch('/auth/me').then(u => {
          setUser(u);
          AsyncStorage.setItem('user_data', JSON.stringify(u));
        }).catch(() => {
          AsyncStorage.multiRemove(['auth_token','user_data']);
          setUser(null);
        });
      }
    } catch {}
    setBooting(false);
  };

  if (booting) {
    return (
      <View style={[s.center, { backgroundColor: C.bg }]}>
        <Text style={{ fontSize: 60 }}>🍺</Text>
        <Text style={s.authTitle}>Hospůdkobraní</Text>
        <ActivityIndicator color={C.amber} style={{ marginTop: 20 }} />
      </View>
    );
  }

  if (!user) return <AuthScreen onLogin={setUser} />;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={{ flex: 1 }}>
        {activeTab === 'map'        && <MapScreen user={user} />}
        {activeTab === 'visits'     && <VisitsScreen user={user} />}
        {activeTab === 'challenges' && <ChallengesScreen user={user} />}
        {activeTab === 'profile'    && <ProfileScreen user={user} onLogout={() => setUser(null)} />}
      </View>
      <TabBar activeTab={activeTab} onTab={setActiveTab} />
    </View>
  );
}

// ─── STYLES ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  screen:       { flex: 1, backgroundColor: C.bg },
  center:       { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },

  // AUTH
  authBg:       { flex: 1 },
  authContainer:{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  authLogo:     { fontSize: 72, marginBottom: 8 },
  authTitle:    { fontSize: 30, fontWeight: '900', color: C.amber, letterSpacing: 1, textAlign: 'center' },
  authSub:      { color: C.creamDim, fontSize: 14, marginTop: 4, marginBottom: 28, textAlign: 'center' },
  authCard:     { backgroundColor: C.bgCard, borderRadius: 20, padding: 20, width: '100%',
                  borderWidth: 1, borderColor: C.border },
  authTabs:     { flexDirection: 'row', marginBottom: 16, borderRadius: 12, overflow: 'hidden',
                  borderWidth: 1, borderColor: C.border },
  authTab:      { flex: 1, paddingVertical: 10, alignItems: 'center' },
  authTabActive:{ backgroundColor: C.amber },
  authTabText:  { color: C.creamDim, fontWeight: '600' },
  authTabTextActive:{ color: C.bg },
  authFooter:   { color: C.creamDim, fontSize: 12, marginTop: 24 },

  // INPUTS
  input:        { backgroundColor: C.bgCardAlt, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
                  color: C.cream, borderWidth: 1, borderColor: C.border, marginBottom: 12, fontSize: 15 },

  // BUTTONS
  btnPrimary:   { backgroundColor: C.amber, borderRadius: 14, paddingVertical: 14, alignItems: 'center',
                  flexDirection: 'row', justifyContent: 'center', gap: 8 },
  btnPrimaryText:{ color: C.bg, fontWeight: '800', fontSize: 15 },
  btnSecondary: { borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingVertical: 12,
                  paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  btnSuccess:   { borderWidth: 1, borderColor: C.green, borderRadius: 14, paddingVertical: 12,
                  alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 },

  // MAP
  mapHud:       { position: 'absolute', top: 50, left: 16, flexDirection: 'row', gap: 10 },
  mapHudBox:    { backgroundColor: 'rgba(15,10,0,0.85)', borderRadius: 12, paddingHorizontal: 14,
                  paddingVertical: 8, borderWidth: 1, borderColor: C.amber, alignItems: 'center' },
  mapHudNum:    { color: C.amber, fontWeight: '900', fontSize: 20 },
  mapHudLabel:  { color: C.creamDim, fontSize: 11 },
  gpsBtn:       { position: 'absolute', bottom: 220, right: 16, backgroundColor: 'rgba(15,10,0,0.9)',
                  borderRadius: 28, width: 52, height: 52, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 1, borderColor: C.amber },

  // PUB SHEET
  pubSheet:     { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.bgCard,
                  borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20,
                  borderWidth: 1, borderBottomWidth: 0, borderColor: C.border },
  pubSheetHandle:{ width: 40, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  pubSheetRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  pubSheetName: { color: C.cream, fontSize: 20, fontWeight: '800' },
  pubSheetType: { color: C.amber, fontSize: 13, marginTop: 2 },
  pubSheetMeta: { color: C.creamDim, fontSize: 13, marginTop: 4 },
  closeBtn:     { padding: 4 },
  ratingText:   { color: C.creamDim, fontSize: 12 },

  // MARKER
  marker:       { backgroundColor: '#1A1200', borderWidth: 2, borderColor: C.amberDark,
                  alignItems: 'center', justifyContent: 'center',
                  shadowColor: C.shadow, shadowOffset:{width:0,height:2}, shadowOpacity:0.5, shadowRadius:4, elevation:4 },
  markerVisited:{ borderColor: C.green, backgroundColor: '#0A1A00' },

  // BADGE
  badge:        { borderWidth: 1, borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4,
                  marginRight: 6, marginBottom: 4 },
  badgeText:    { fontSize: 12, fontWeight: '600' },

  // MODAL
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard:    { backgroundColor: C.bgCard, borderTopLeftRadius: 24, borderTopRightRadius: 24,
                  padding: 20, maxHeight: SCREEN_H * 0.85, borderWidth: 1, borderBottomWidth: 0, borderColor: C.border },
  modalHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle:   { color: C.amber, fontSize: 18, fontWeight: '800' },
  modalPubName: { color: C.creamDim, fontSize: 14, marginBottom: 16 },
  questionText: { color: C.cream, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  answerBtn:    { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
                  borderRadius: 12, borderWidth: 1, borderColor: C.border, marginBottom: 8 },
  answerBtnActive:{ borderColor: C.amber, backgroundColor: '#221200' },
  answerText:   { color: C.creamDim, fontSize: 15, flex: 1 },
  answerTextActive:{ color: C.cream },
  starsRow:     { flexDirection: 'row', justifyContent: 'center', marginVertical: 16 },
  photoThumb:   { marginRight: 8, position: 'relative' },
  photoRemove:  { position: 'absolute', top: -6, right: -6 },
  photoAdd:     { width: 70, height: 70, borderRadius: 8, borderWidth: 1, borderColor: C.border,
                  alignItems: 'center', justifyContent: 'center', borderStyle: 'dashed' },

  // PAGE
  pageHeader:   { paddingTop: 52, paddingHorizontal: 20, paddingBottom: 12, backgroundColor: C.bg },
  pageTitle:    { color: C.amber, fontSize: 28, fontWeight: '900', letterSpacing: 0.5 },
  pageSubtitle: { color: C.creamDim, fontSize: 14, marginTop: 2 },

  // SORT
  sortBar:      { flexDirection: 'row', paddingHorizontal: 16, marginBottom: 12, gap: 8 },
  sortBtn:      { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
                  borderWidth: 1, borderColor: C.border },
  sortBtnActive:{ backgroundColor: C.amber, borderColor: C.amber },
  sortBtnText:  { color: C.creamDim, fontSize: 13, fontWeight: '600' },
  sortBtnTextActive:{ color: C.bg },

  // STATS ROW
  statsRow:     { flexDirection: 'row', marginHorizontal: 16, marginBottom: 12, gap: 8 },
  statBox:      { flex: 1, backgroundColor: C.bgCard, borderRadius: 14, padding: 12, alignItems: 'center',
                  borderWidth: 1, borderColor: C.border },
  statNum:      { color: C.amber, fontSize: 22, fontWeight: '900' },
  statLabel:    { color: C.creamDim, fontSize: 11, marginTop: 2, textAlign: 'center' },

  // VISIT CARD
  visitCard:    { backgroundColor: C.bgCard, borderRadius: 16, padding: 14, marginBottom: 10,
                  borderWidth: 1, borderColor: C.border },
  visitCardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  visitCardEmoji:{ fontSize: 28 },
  visitCardName:{ color: C.cream, fontSize: 16, fontWeight: '700' },
  visitCardType:{ color: C.amber, fontSize: 12, marginBottom: 4 },
  visitCardDate:{ color: C.creamDim, fontSize: 13, fontWeight: '600' },
  visitCardTime:{ color: C.creamDim, fontSize: 11 },
  visitCardNote:{ color: C.creamDim, fontSize: 13, fontStyle: 'italic', marginTop: 8,
                  paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },

  // CHALLENGE CARD
  challengeCard:{ backgroundColor: C.bgCard, borderRadius: 16, padding: 14, marginBottom: 10,
                  borderWidth: 1, borderColor: C.border },
  challengeCardDone:{ borderColor: C.green },
  challengeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  challengeIcon:{ fontSize: 28 },
  challengeName:{ color: C.cream, fontSize: 15, fontWeight: '700' },
  challengeDesc:{ color: C.creamDim, fontSize: 13, marginTop: 2 },
  challengeDoneBadge:{ fontSize: 22 },
  progressTrack:{ height: 6, backgroundColor: C.bgCardAlt, borderRadius: 3, overflow: 'hidden' },
  progressBar:  { height: 6, borderRadius: 3 },
  progressText: { color: C.creamDim, fontSize: 12, marginTop: 6 },

  // PROFILE
  profileCard:  { margin: 16, backgroundColor: C.bgCard, borderRadius: 20, padding: 20, alignItems: 'center',
                  borderWidth: 1, borderColor: C.border },
  avatarWrap:   { position: 'relative', marginBottom: 12 },
  avatar:       { width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: C.amber },
  avatarPlaceholder:{ width: 90, height: 90, borderRadius: 45, backgroundColor: C.bgCardAlt,
                  borderWidth: 3, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  avatarEdit:   { position: 'absolute', bottom: 0, right: 0, backgroundColor: C.amber,
                  borderRadius: 12, padding: 4 },
  profileName:  { color: C.cream, fontSize: 22, fontWeight: '900' },
  profileEmail: { color: C.creamDim, fontSize: 13, marginTop: 2, marginBottom: 10 },
  bioText:      { color: C.creamDim, fontSize: 14, textAlign: 'center', fontStyle: 'italic' },

  // STATS GRID
  statsGrid:    { flexDirection: 'row', flexWrap: 'wrap', margin: 16, gap: 10 },
  statsGridItem:{ flex: 1, minWidth: '45%', backgroundColor: C.bgCard, borderRadius: 16, padding: 14,
                  alignItems: 'center', borderWidth: 1, borderColor: C.border },
  statsGridIcon:{ fontSize: 24, marginBottom: 4 },
  statsGridNum: { color: C.amber, fontSize: 26, fontWeight: '900' },
  statsGridLabel:{ color: C.creamDim, fontSize: 12, marginTop: 2 },

  // OFFLINE
  offlineBanner:{ margin: 16, backgroundColor: '#1A1200', borderRadius: 14, padding: 12,
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  borderWidth: 1, borderColor: C.amber },
  offlineText:  { color: C.cream, flex: 1, fontSize: 13 },
  syncBtn:      { backgroundColor: C.amber, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 6 },
  syncBtnText:  { color: C.bg, fontWeight: '800', fontSize: 13 },

  // SEARCH
  sectionBlock: { margin: 16, marginTop: 0 },
  sectionLabel: { color: C.amber, fontSize: 15, fontWeight: '700', marginBottom: 10 },
  searchRow:    { flexDirection: 'row', gap: 8, alignItems: 'center' },
  searchBtn:    { backgroundColor: C.amber, borderRadius: 12, width: 44, height: 44,
                  alignItems: 'center', justifyContent: 'center' },
  foundUserCard:{ backgroundColor: C.bgCard, borderRadius: 16, padding: 14, marginTop: 10,
                  borderWidth: 1, borderColor: C.border },
  foundUserName:{ color: C.cream, fontSize: 18, fontWeight: '800', marginBottom: 4 },
  foundUserBio: { color: C.creamDim, fontSize: 13, fontStyle: 'italic', marginBottom: 8 },
  foundUserStats:{ flexDirection: 'row', gap: 16, marginBottom: 6 },
  foundUserStat:{ color: C.amber, fontWeight: '600', fontSize: 14 },
  foundUserDate:{ color: C.creamDim, fontSize: 12 },

  // SETTINGS
  settingsRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14,
                  borderBottomWidth: 1, borderBottomColor: C.border },
  settingsRowText:{ fontSize: 15, fontWeight: '600' },

  // MISC
  empty:        { alignItems: 'center', marginTop: 80 },
  emptyEmoji:   { fontSize: 60, marginBottom: 12 },
  emptyText:    { color: C.cream, fontSize: 18, fontWeight: '700' },
  emptySubtext: { color: C.creamDim, fontSize: 14, marginTop: 6, textAlign: 'center' },
  versionText:  { color: C.border, fontSize: 12, textAlign: 'center', marginTop: 20, paddingBottom: 10 },

  // TAB BAR
  tabBar:       { flexDirection: 'row', backgroundColor: C.tabBar, borderTopWidth: 1, borderTopColor: C.border,
                  paddingBottom: Platform.OS === 'ios' ? 24 : 8, paddingTop: 8 },
  tabItem:      { flex: 1, alignItems: 'center', position: 'relative', paddingVertical: 4 },
  tabLabel:     { fontSize: 10, marginTop: 3, fontWeight: '600' },
  tabDot:       { position: 'absolute', bottom: -2, width: 4, height: 4, borderRadius: 2, backgroundColor: C.amber },
});