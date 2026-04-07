/**
 * Hospůdkobraní – App.js v1.2.1
 * Změny: offline hospůdky + stahování oblastí, návrhy nových hospůdek, nahlašování chyb,
 *        distance-based Odkliknout tlačítko, oprava vracení mapy, offline login fix,
 *        viditelnost poznámek a fotek, lajky fotek v galerii, oprava výzev (cap na target)
 */
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput,
  Alert, Modal, Image, ActivityIndicator, FlatList, Dimensions,
  Platform, StatusBar, Animated, KeyboardAvoidingView, RefreshControl,
  Linking, SafeAreaView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { WebView } from 'react-native-webview';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import NetInfo from '@react-native-community/netinfo';

const { width: SW, height: SH } = Dimensions.get('window');
const API = 'https://fluffini.cz/api';

// ─── THEME ────────────────────────────────────────────────────────────────────
const C = {
  bg: '#0F0A00', bgCard: '#1A1200', bgCardAlt: '#221900',
  amber: '#F5A623', amberDark: '#C07D10', gold: '#D4A017',
  cream: '#F5ECD7', creamDim: '#A89070',
  red: '#C0392B', green: '#27AE60', blue: '#2980B9',
  border: '#3D2800', white: '#FFFFFF', tabBar: '#130D00', star: '#FFD700',
  purple: '#8E44AD', teal: '#16A085',
};

// ─── TILE LAYERS ──────────────────────────────────────────────────────────────
const TILES = [
  { key:'osm',   label:'OpenStreetMap', url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',                                                          attrib:'© OpenStreetMap contributors' },
  { key:'locus', label:'Locus Map',     url:'https://tile.thunderforest.com/locus-4za/{z}/{x}/{y}.png?apikey=f944003b5ba34ff3a30dafe96e581f06', attrib:'© Thunderforest, © OSM' },
];

// ─── LEAFLET HTML (pro WebView) ───────────────────────────────────────────────
const MAP_HTML = `<!DOCTYPE html>
<html><head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}html,body,#map{width:100%;height:100vh}
    .pin{width:30px;height:30px;border-radius:50%;background:#F5A623;border:2px solid #C07D10;
         display:flex;align-items:center;justify-content:center;font-size:16px}
    .pin.v{background:#27AE60;border-color:#1e8449}
  </style>
</head><body><div id="map"></div><script>
  var LAYERS={
    osm:  {url:'https://tile.openstreetmap.org/{z}/{x}/{y}.png',attr:'\u00a9 OpenStreetMap contributors'},
    locus:{url:'https://tile.thunderforest.com/locus-4za/{z}/{x}/{y}.png?apikey=f944003b5ba34ff3a30dafe96e581f06',attr:'\u00a9 Thunderforest, \u00a9 OSM'}
  };
  var CACHE='hospudka-v1';
  var CachedLayer=L.TileLayer.extend({
    createTile:function(c,done){
      var img=document.createElement('img');
      img.setAttribute('role','presentation');
      var url=this.getTileUrl(c);
      if(!('caches' in window)){
        img.src=url;img.onload=function(){done(null,img);};img.onerror=function(e){done(e,img);};return img;
      }
      caches.open(CACHE).then(function(cache){
        return cache.match(url).then(function(hit){
          if(hit)return hit.blob();
          return fetch(url).then(function(r){if(r.ok)cache.put(url,r.clone());return r.blob();});
        });
      }).then(function(b){img.src=URL.createObjectURL(b);done(null,img);}).catch(function(e){done(e,img);});
      return img;
    }
  });
  var map=L.map('map',{zoomControl:true}).setView([49.7384,13.3736],9);
  var active=new CachedLayer(LAYERS.osm.url,{attribution:LAYERS.osm.attr,maxZoom:19});
  active.addTo(map);
  var mk={};
  function icon(v){return L.divIcon({className:'',html:'<div class="pin'+(v?' v':'')+'">\ud83c\udf7a<\/div>',iconSize:[30,30],iconAnchor:[15,15]});}
  function postRN(m){if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(m));}
  function handle(e){
    var msg;try{msg=JSON.parse(e.data);}catch(err){return;}
    if(msg.type==='pubs'){
      Object.keys(mk).forEach(function(k){mk[k].remove();});mk={};
      msg.pubs.forEach(function(p){
        var m=L.marker([p.lat,p.lng],{icon:icon(p.v)}).addTo(map);
        m.on('click',function(){postRN({type:'pubTap',id:p.id});});
        mk[p.id]=m;
      });
    }else if(msg.type==='flyTo'){
      map.flyTo([msg.lat,msg.lng],msg.zoom||14);
    }else if(msg.type==='setLayer'){
      map.removeLayer(active);
      var cfg=LAYERS[msg.key];
      if(cfg){active=new CachedLayer(cfg.url,{attribution:cfg.attr,maxZoom:19});active.addTo(map);}
    }
  }
  document.addEventListener('message',handle);
  window.addEventListener('message',handle);
  map.on('click',function(e){postRN({type:'mapClick',lat:e.latlng.lat,lng:e.latlng.lng});});
  window.onload=function(){postRN({type:'ready'});};
<\/script></body></html>`;

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
  { code:'CZ', name:'Česká republika', flag:'🇨🇿' },
  { code:'SK', name:'Slovensko',        flag:'🇸🇰' },
  { code:'AT', name:'Rakousko',         flag:'🇦🇹' },
  { code:'DE', name:'Německo',          flag:'🇩🇪' },
  { code:'PL', name:'Polsko',           flag:'🇵🇱' },
  { code:'HU', name:'Maďarsko',         flag:'🇭🇺' },
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

const Chip = ({ label, color=C.amber, icon }) => (
  <View style={[s.chip,{borderColor:color}]}>
    {icon && <Ionicons name={icon} size={11} color={color} style={{marginRight:3}} />}
    <Text style={[s.chipText,{color}]}>{label}</Text>
  </View>
);

// Fullscreen photo viewer
const PhotoViewer = ({ photos, startIndex, onClose }) => {
  const [cur, setCur] = useState(startIndex);
  const fa = useRef(new Animated.Value(0)).current;
  useEffect(()=>{ Animated.timing(fa,{toValue:1,duration:200,useNativeDriver:true}).start(); },[]);
  const close = ()=>{ Animated.timing(fa,{toValue:0,duration:150,useNativeDriver:true}).start(onClose); };
  return (
    <Modal visible animationType="none" transparent statusBarTranslucent>
      <Animated.View style={[s.pvBg,{opacity:fa}]}>
        <Image source={{uri:photos[cur].url}} style={s.pvImg} resizeMode="contain" />
        <Text style={s.pvAuthor}>{photos[cur].username||''}</Text>
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
    </Modal>
  );
};

// User profile modal (fullscreen avatar support for foreign users)
const UserProfileModal = ({ username, selfId, onClose }) => {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [bigAvatar, setBigAvatar] = useState(false);
  useEffect(()=>{
    apiFetch(`/users/find?q=${encodeURIComponent(username)}`).then(setProfile).catch(()=>setProfile(null)).finally(()=>setLoading(false));
  },[username]);
  const isSelf = profile && profile.id === selfId;
  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <View style={[s.modalCard,{maxHeight:SH*0.65}]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>Profil Hospůdkobraníka</Text>
            <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
          </View>
          {loading ? <ActivityIndicator color={C.amber} style={{margin:24}}/> : !profile ? (
            <Text style={[s.dimText,{margin:20}]}>Profil nenalezen.</Text>
          ) : (
            <View style={{alignItems:'center',paddingVertical:10}}>
              <Avatar url={profile.avatar_url} size={80}
                onPress={isSelf ? undefined : ()=>setBigAvatar(true)}
                style={{marginBottom:10}} />
              {!isSelf && <Text style={[s.dimText,{fontSize:11,marginBottom:8}]}>Klepni na foto pro zvětšení</Text>}
              <Text style={s.profileName}>{profile.username}</Text>
              {profile.bio && <Text style={[s.bioText,{marginTop:6,paddingHorizontal:10}]}>{profile.bio}</Text>}
              <View style={{flexDirection:'row',gap:12,marginTop:14}}>
                <View style={s.statBox}><Text style={s.statNum}>{profile.total_visits}</Text><Text style={s.statLabel}>hospůdek</Text></View>
                <View style={s.statBox}><Text style={s.statNum}>{profile.avg_rating?.toFixed(1)??'–'}</Text><Text style={s.statLabel}>průměr ⭐</Text></View>
                {profile.firstlast_count > 0 && (
                  <View style={s.statBox}><Text style={s.statNum}>{profile.firstlast_count}</Text><Text style={s.statLabel}>prvochlasty</Text></View>
                )}
              </View>
              <Text style={[s.dimText,{marginTop:12,fontSize:11}]}>Člen od {new Date(profile.created_at).toLocaleDateString('cs-CZ')}</Text>
            </View>
          )}
        </View>
      </View>
      {bigAvatar && profile?.avatar_url && (
        <PhotoViewer photos={[{url:profile.avatar_url,username:profile.username}]} startIndex={0} onClose={()=>setBigAvatar(false)} />
      )}
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// PUB DETAIL MODAL
// ══════════════════════════════════════════════════════════════════════════════
const PubDetailModal = ({ pub, onClose }) => {
  const [reviews, setReviews] = useState([]);
  const [photos, setPhotos]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [pv, setPv] = useState(null);
  const [userModal, setUserModal] = useState(null);
  const [reportMod, setReportMod] = useState(false);

  useEffect(()=>{
    Promise.all([
      apiFetch(`/pubs/${pub.id}/reviews`).catch(()=>[]),
      apiFetch(`/pubs/${pub.id}/photos`).catch(()=>[]),
    ]).then(([r,p])=>{ setReviews(r); setPhotos(p); setLoading(false); });
  },[pub.id]);

  return (
    <Modal visible animationType="slide" transparent>
      <View style={s.modalOverlay}>
        <View style={[s.modalCard,{maxHeight:SH*0.88}]}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>{pub.name}</Text>
            <View style={{flexDirection:'row',alignItems:'center',gap:10}}>
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
                onPress={()=>Linking.openURL(`https://nominatim.openstreetmap.org/ui/search.html?q=${encodeURIComponent(pub.address)}`)}>
                <Ionicons name="location-outline" size={14} color={C.blue}/>
                <Text style={[s.dimText,{color:C.blue,textDecorationLine:'underline'}]}>{pub.address}</Text>
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

            {loading ? <ActivityIndicator color={C.amber} style={{marginVertical:20}}/> : (
              <>
                {photos.length>0 && (
                  <View style={{marginTop:14}}>
                    <Text style={s.secLabel}>Fotky ({photos.length})</Text>
                    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                      {photos.map((p,i)=>(
                        <TouchableOpacity key={i} onPress={()=>setPv(i)} activeOpacity={0.85} style={{position:'relative'}}>
                          <Image source={{uri:p.url}} style={{width:120,height:90,borderRadius:10,marginRight:8}} resizeMode="cover"/>
                          <View style={s.expandOverlay}><Ionicons name="expand-outline" size={14} color={C.white}/></View>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
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
      {pv!==null && <PhotoViewer photos={photos} startIndex={pv} onClose={()=>setPv(null)}/>}
      {userModal && <UserProfileModal username={userModal} selfId={null} onClose={()=>setUserModal(null)}/>}
      {reportMod && <ReportPubModal pub={pub} onClose={()=>setReportMod(false)}/>}
    </Modal>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// FILTER MODAL
// ══════════════════════════════════════════════════════════════════════════════
const PUB_TYPES = ['hospoda','restaurace','hostinec','kiosek','jiné'];
const DEF_FILTERS = { visited:'all', types:[], card:'any', minRating:0, beer:'' };

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
// OFFLINE OBLASTI MODAL
// ══════════════════════════════════════════════════════════════════════════════
const OfflineRegionsModal = ({ onClose, onAreaDownloaded }) => {
  const [areas, setAreas]         = useState([]);
  const [downloading, setDl]      = useState(null);
  const [pubCounts, setPubCounts] = useState({});

  useEffect(()=>{ loadAreas(); },[]);

  const loadAreas = async () => {
    const a = await getOfflineAreas(); setAreas(a);
    const pubs = await getOfflinePubs();
    const cnt = {};
    pubs.forEach(p=>{ if(p.country){ cnt[p.country]=(cnt[p.country]||0)+1; } });
    setPubCounts(cnt);
  };

  const download = async (country) => {
    setDl(country.code);
    try {
      const fresh = await apiFetch(`/pubs?country=${country.code}`);
      const existing = await getOfflinePubs();
      const ids = new Set(fresh.map(p=>p.id));
      const merged = [...existing.filter(p=>!ids.has(p.id)), ...fresh.map(p=>({...p,country:country.code}))];
      await saveOfflinePubs(merged);
      const existing2 = await getOfflineAreas();
      if (!existing2.includes(country.code)) await saveOfflineAreas([...existing2, country.code]);
      setAreas(a => [...new Set([...a, country.code])]);
      setPubCounts(c=>({...c,[country.code]:fresh.length}));
      Alert.alert('Staženo ✓', `${country.name}: ${fresh.length} hospůdek uloženo offline.`);
      onAreaDownloaded?.();
    } catch(e) { Alert.alert('Chyba stahování', e.message); }
    setDl(null);
  };

  const remove = (code) => {
    const country = COUNTRIES.find(c=>c.code===code);
    Alert.alert(`Smazat ${country?.name}?`, 'Hospůdky z dané oblasti budou odebrány z offline úložiště.', [
      {text:'Zrušit',style:'cancel'},
      {text:'Smazat',style:'destructive', onPress: async () => {
        const pubs = await getOfflinePubs();
        await saveOfflinePubs(pubs.filter(p=>p.country!==code));
        const newAreas = areas.filter(a=>a!==code);
        await saveOfflineAreas(newAreas);
        setAreas(newAreas);
        setPubCounts(c=>{ const n={...c}; delete n[code]; return n; });
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
              return (
                <View key={c.code} style={s.areaRow}>
                  <Text style={s.areaFlag}>{c.flag}</Text>
                  <View style={{flex:1}}>
                    <Text style={[s.areaName,downloaded&&{color:C.green}]}>{c.name}</Text>
                    {downloaded&&count!=null&&<Text style={s.dimText}>{count} hospůdek</Text>}
                  </View>
                  {downloaded ? (
                    <View style={{flexDirection:'row',gap:8}}>
                      <TouchableOpacity style={s.areaDlBtn} onPress={()=>download(c)} disabled={!!downloading}>
                        {isDown?<ActivityIndicator size="small" color={C.bg}/>:<Ionicons name="refresh-outline" size={15} color={C.bg}/>}
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
// MAP LAYER MODAL
// ══════════════════════════════════════════════════════════════════════════════
const LayerModal = ({ curKey, onSelect, onClose }) => (
  <Modal visible animationType="slide" transparent>
    <View style={s.modalOverlay}>
      <View style={s.modalCard}>
        <View style={s.modalHeader}>
          <Text style={s.modalTitle}>Mapová vrstva</Text>
          <TouchableOpacity onPress={onClose}><Ionicons name="close" size={22} color={C.creamDim}/></TouchableOpacity>
        </View>
        <ScrollView showsVerticalScrollIndicator={false}>
          {TILES.map(t=>(
            <TouchableOpacity key={t.key} style={[s.layerRow,curKey===t.key&&{borderBottomColor:C.amber}]}
              onPress={()=>{onSelect(t.key,t.url,t.attrib);onClose();}}>
              <Ionicons name="map-outline" size={20} color={curKey===t.key?C.amber:C.creamDim}/>
              <View style={{flex:1,marginLeft:10}}>
                <Text style={[s.layerLabel,curKey===t.key&&{color:C.amber}]}>{t.label}</Text>
                <Text style={s.dimText} numberOfLines={1}>{t.url.split('?')[0]}</Text>
              </View>
              {curKey===t.key&&<Ionicons name="checkmark-circle" size={20} color={C.amber}/>}
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    </View>
  </Modal>
);

// ══════════════════════════════════════════════════════════════════════════════
// MAP SCREEN – WebView + Leaflet
// ══════════════════════════════════════════════════════════════════════════════
const MapScreen = ({ user }) => {
  const webViewRef      = useRef(null);
  const hasCenteredRef  = useRef(false);
  const suggestModeRef  = useRef(false);

  const [pubs, setPubs]                 = useState([]);
  const [visited, setVisited]           = useState(new Set());
  const [loc, setLoc]                   = useState(null);
  const [loading, setLoading]           = useState(true);
  const [mapReady, setMapReady]         = useState(false);
  const [selPub, setSelPub]             = useState(null);
  const [showSheet, setShowSheet]       = useState(false);
  const [showInfo, setShowInfo]         = useState(false);
  const [logModal, setLogModal]         = useState(false);
  const [filterMod, setFilterMod]       = useState(false);
  const [layerMod, setLayerMod]         = useState(false);
  const [offlineRegionsMod, setOffReg]  = useState(false);
  const [reportMod, setReportMod]       = useState(false);
  const [suggestMode, setSuggestMode]   = useState(false);
  const [suggestCoords, setSuggestCo]   = useState(null);
  const [suggestModal, setSuggestMod]   = useState(false);
  const [filters, setFilters]           = useState({...DEF_FILTERS});
  const [tileKey, setTileKey]           = useState('osm');
  const slideAnim = useRef(new Animated.Value(300)).current;

  const fCount = useMemo(()=>{
    let n=0;
    if(filters.visited!=='all')n++;
    if(filters.types?.length>0)n++;
    if(filters.card!=='any')n++;
    if(filters.minRating>0)n++;
    if(filters.beer?.trim())n++;
    return n;
  },[filters]);

  useEffect(()=>{loadData();setupLoc();loadPrefs();},[]);

  const loadPrefs = async () => {
    const tk = await AsyncStorage.getItem('tk');
    if (tk && TILES.find(t=>t.key===tk)) setTileKey(tk);
  };

  const sendToWebView = msg => {
    webViewRef.current?.injectJavaScript(
      `handle({data:${JSON.stringify(JSON.stringify(msg))}});true;`
    );
  };

  const loadData = async () => {
    try {
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
    } catch(e){console.error(e);}
    finally{setLoading(false);}
  };

  const setupLoc = async () => {
    const {status} = await Location.requestForegroundPermissionsAsync();
    if(status!=='granted')return;
    const l = await Location.getCurrentPositionAsync({accuracy:Location.Accuracy.High});
    setLoc(l.coords);
    Location.watchPositionAsync({accuracy:Location.Accuracy.High,distanceInterval:5},ll=>setLoc(ll.coords));
  };

  // filtered MUSÍ být deklarováno před useEffect co jej používá v dep array
  const filtered = useMemo(()=>pubs.filter(p=>{
    if(filters.visited==='visited'  &&!visited.has(p.id))return false;
    if(filters.visited==='unvisited'&& visited.has(p.id))return false;
    if(filters.types?.length>0&&!filters.types.includes(p.type))return false;
    if(filters.card==='yes'&&!p.card_payment)return false;
    if(filters.card==='no'&&p.card_payment)return false;
    if(filters.minRating>0&&(p.avg_rating||0)<filters.minRating)return false;
    if(filters.beer?.trim()&&!p.beers?.toLowerCase().includes(filters.beer.toLowerCase()))return false;
    return true;
  }),[pubs,visited,filters]);

  // Sync markers whenever filtered pubs or visited set changes
  useEffect(()=>{
    if(!mapReady||pubs.length===0)return;
    const data=filtered.map(p=>({id:p.id,lat:p.latitude,lng:p.longitude,v:visited.has(p.id)}));
    sendToWebView({type:'pubs',pubs:data});
  },[mapReady,filtered,visited]);

  // Fly to user location ONLY ONCE when map and loc are both ready
  useEffect(()=>{
    if(!mapReady||!loc||hasCenteredRef.current)return;
    hasCenteredRef.current = true;
    sendToWebView({type:'flyTo',lat:loc.latitude,lng:loc.longitude,zoom:14});
  },[mapReady,loc]);

  const onWebViewMessage = e => {
    const msg=JSON.parse(e.nativeEvent.data);
    if(msg.type==='ready'){setMapReady(true);}
    else if(msg.type==='pubTap'){const pub=pubs.find(p=>p.id===msg.id);if(pub)openPub(pub);}
    else if(msg.type==='mapClick'){
      if(suggestModeRef.current){
        setSuggestCo({lat:msg.lat,lng:msg.lng});
        setSuggestMod(true);
        suggestModeRef.current=false;
        setSuggestMode(false);
      }
    }
  };

  const selPubDist = useMemo(()=>{
    if(!loc||!selPub)return null;
    return Math.round(hav(loc.latitude,loc.longitude,selPub.latitude,selPub.longitude));
  },[loc,selPub]);

  const openPub = pub => {
    setSelPub(pub); setShowSheet(true);
    Animated.spring(slideAnim,{toValue:0,useNativeDriver:true,tension:100}).start();
  };
  const closeSheet = ()=>{
    Animated.timing(slideAnim,{toValue:300,duration:200,useNativeDriver:true}).start(()=>{
      setShowSheet(false); setSelPub(null);
    });
  };
  const tryLog = pub => {
    if(!loc){Alert.alert('GPS potřeba','Zapni polohu.');return;}
    const d = hav(loc.latitude,loc.longitude,pub.latitude,pub.longitude);
    if(d>25){Alert.alert('Příliš daleko',`Jsi ${Math.round(d)} m od hospůdky. Musíš být do 25 m.`);return;}
    setLogModal(true);
  };
  const applyLayer = (key,url,attrib)=>{
    setTileKey(key);
    sendToWebView({type:'setLayer',key});
    AsyncStorage.setItem('tk',key);
  };

  if(loading) return <View style={s.center}><ActivityIndicator color={C.amber} size="large"/></View>;

  return (
    <View style={{flex:1}}>
      <WebView
        ref={webViewRef}
        source={{html:MAP_HTML}}
        style={{flex:1}}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        cacheEnabled={true}
        userAgent="Hospudkobrani/1.4 (React Native)"
        originWhitelist={['*']}
        onMessage={onWebViewMessage}
      />

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
          sendToWebView({type:'flyTo',lat:loc.latitude,lng:loc.longitude,zoom:14});
        }}>
          <Ionicons name="locate-outline" size={22} color={C.amber}/>
        </TouchableOpacity>
        <TouchableOpacity style={s.mapBtn} onPress={()=>setFilterMod(true)}>
          <Ionicons name="options-outline" size={22} color={fCount>0?C.amber:C.creamDim}/>
          {fCount>0&&<View style={s.fBadge}><Text style={s.fBadgeT}>{fCount}</Text></View>}
        </TouchableOpacity>
        <TouchableOpacity style={s.mapBtn} onPress={()=>setLayerMod(true)}>
          <Ionicons name="layers-outline" size={22} color={C.creamDim}/>
        </TouchableOpacity>
        <TouchableOpacity style={s.mapBtn} onPress={()=>setOffReg(true)}>
          <Ionicons name="download-outline" size={22} color={C.creamDim}/>
        </TouchableOpacity>
        <TouchableOpacity style={[s.mapBtn,suggestMode&&{borderColor:C.amber,borderWidth:2}]}
          onPress={()=>{
            const next=!suggestModeRef.current;
            suggestModeRef.current=next;
            setSuggestMode(next);
          }}>
          <Ionicons name="add-outline" size={24} color={suggestMode?C.amber:C.creamDim}/>
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
            <TouchableOpacity style={[s.btnSec,{paddingHorizontal:12}]} onPress={()=>setReportMod(true)}>
              <Ionicons name="flag-outline" size={20} color={C.creamDim}/>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btnSec,{paddingHorizontal:12}]} onPress={()=>setShowInfo(true)}>
              <Ionicons name="information-circle-outline" size={22} color={C.amber}/>
            </TouchableOpacity>
          </View>
        </Animated.View>
      )}

      {showInfo&&selPub&&<PubDetailModal pub={selPub} onClose={()=>setShowInfo(false)}/>}
      {reportMod&&selPub&&<ReportPubModal pub={selPub} onClose={()=>setReportMod(false)}/>}
      {logModal&&selPub&&(
        <LogModal pub={selPub} user={user} onClose={()=>setLogModal(false)}
          onSuccess={()=>{
            setVisited(p=>new Set([...p,selPub.id]));
            bust(`v_${user.id}`); setLogModal(false); closeSheet();
          }}/>
      )}
      {filterMod&&<FilterModal filters={filters} onApply={f=>setFilters(f)} onClose={()=>setFilterMod(false)}/>}
      {layerMod&&<LayerModal curKey={tileKey} onSelect={applyLayer} onClose={()=>setLayerMod(false)}/>}
      {offlineRegionsMod&&<OfflineRegionsModal onClose={()=>setOffReg(false)} onAreaDownloaded={loadData}/>}
      {suggestModal&&suggestCoords&&<SuggestPubModal lat={suggestCoords.lat} lng={suggestCoords.lng} onClose={()=>setSuggestMod(false)}/>}
    </View>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// LOG MODAL
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
    const payload={pub_id:pub.id,answer_id:ans,rating,note,note_visibility:noteViz,photo_visibility:photosViz,logged_at:new Date().toISOString()};
    try{
      if(online){
        await apiFetch('/visits',{method:'POST',body:JSON.stringify(payload)});
        for(const uri of photos){
          const fd=new FormData();
          fd.append('photo',{uri,name:'photo.jpg',type:'image/jpeg'});
          fd.append('pub_id',String(pub.id));
          await fetch(`${API}/visits/photo`,{method:'POST',headers:{Authorization:`Bearer ${await getToken()}`},body:fd});
        }
      }else{
        await pushQ({type:'visit',payload,photos});
        Alert.alert('Offline','Odkliknutí uloženo lokálně.');
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
// AUTH SCREEN
// ══════════════════════════════════════════════════════════════════════════════
const AuthScreen = ({ onLogin }) => {
  const [mode, setMode]   = useState('login');
  const [email, setEmail] = useState('');
  const [pw, setPw]       = useState('');
  const [nick, setNick]   = useState('');
  const [busy, setBusy]   = useState(false);
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
      onLogin(data.user);
    }catch(e){Alert.alert('Chyba',e.message);}
    finally{setBusy(false);}
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
          </View>
          <Text style={s.authFooter}>Pij s rozumem, sbírej bez hranic</Text>
        </Animated.View>
      </LinearGradient>
    </View>
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
        <View style={s.visitIcon}><Ionicons name="beer-outline" size={22} color={C.amber}/></View>
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
      {detailPub&&<PubDetailModal pub={detailPub} onClose={()=>setDetail(null)}/>}
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

// Chat sub-tab
const ChatTab = ({ user }) => {
  const [msgs, setMsgs]       = useState([]);
  const [text, setText]       = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);

  useEffect(()=>{ loadMsgs(); const t=setInterval(loadMsgs,10000); return()=>clearInterval(t); },[]);

  const loadMsgs = async()=>{
    try{ const d=await apiFetch('/community/chat?limit=50'); setMsgs(d); }
    catch{}
    setLoading(false);
  };

  const send = async()=>{
    const t=text.trim(); if(!t)return;
    setSending(true); setText('');
    try{
      await apiFetch('/community/chat',{method:'POST',body:JSON.stringify({message:t})});
      loadMsgs();
    }catch(e){Alert.alert('Chyba',e.message);}
    finally{setSending(false);}
  };

  const renderItem=({item})=>{
    const isMe=item.user_id===user.id;
    return(
      <View style={[s.msgRow,isMe&&{flexDirection:'row-reverse'}]}>
        {!isMe&&<Avatar url={item.avatar_url} size={28} style={{marginRight:6}}/>}
        <View style={{maxWidth:'75%'}}>
          {!isMe&&<Text style={[s.dimText,{fontSize:11,marginBottom:2}]}>{item.username}</Text>}
          <View style={[s.msgBubble,isMe&&s.msgBubbleMe]}>
            <Text style={[s.msgText,isMe&&{color:C.bg}]}>{item.message}</Text>
          </View>
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
      <FlatList ref={listRef} data={[...msgs].reverse()} keyExtractor={i=>String(i.id)} renderItem={renderItem}
        contentContainerStyle={{padding:12,paddingBottom:4}} inverted
        onContentSizeChange={()=>listRef.current?.scrollToOffset({offset:0})}
      />
      <KeyboardAvoidingView behavior={Platform.OS==='ios'?'padding':'height'}>
        <View style={s.chatInput}>
          <TextInput style={[s.input,{flex:1,marginBottom:0}]} placeholder="Zpráva…" placeholderTextColor={C.creamDim}
            value={text} onChangeText={setText} onSubmitEditing={send} returnKeyType="send"/>
          <TouchableOpacity style={[s.btnPri,{paddingHorizontal:16,paddingVertical:12}]} onPress={send} disabled={sending}>
            {sending?<ActivityIndicator color={C.bg} size="small"/>:<Ionicons name="send" size={18} color={C.bg}/>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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

const GalleryTab = () => {
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
      {pv!==null&&<PhotoViewer photos={photos} startIndex={pv} onClose={()=>setPv(null)}/>}
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
        {tab==='gallery'     && <GalleryTab/>}
      </View>
    </View>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
// PROFILE SCREEN (renovated)
// ══════════════════════════════════════════════════════════════════════════════
const ProfileScreen = ({ user, onLogout }) => {
  const [me, setMe]             = useState(user);
  const [editBio, setEditBio]   = useState(false);
  const [bio, setBio]           = useState(user.bio||'');
  const [stats, setStats]       = useState(null);
  const [period, setPeriod]     = useState('total'); // total|year|month|day
  const [photos, setPhotos]     = useState([]);
  const [rank, setRank]         = useState(null);
  const [pv, setPv]             = useState(null);
  const [offQ, setOffQ]         = useState(0);
  const [syncing, setSyncing]   = useState(false);
  const [loading, setLoading]   = useState(true);

  useEffect(()=>{ loadAll(); checkOff(); },[]);
  useEffect(()=>{ loadStats(); },[period]);

  const loadAll = async()=>{
    await Promise.all([loadStats(), loadPhotos(), loadRank()]);
    setLoading(false);
  };

  const loadStats = async()=>{
    try{
      const d=await apiFetch(`/profile/stats?period=${period}`);
      setStats(d);
    }catch{}
  };

  const loadPhotos = async()=>{
    try{ const d=await apiFetch('/profile/my-photos'); setPhotos(d); }catch{}
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

  const PERIODS=[['total','Celkem'],['year','Rok'],['month','Měsíc'],['day','Den']];

  return(
    <ScrollView style={s.screen} contentContainerStyle={{paddingBottom:100}}>
      <View style={s.pageHdr}><Text style={s.pageTitle}>Profil</Text></View>

      {/* Avatar + info */}
      <View style={s.profileCard}>
        <TouchableOpacity onPress={pickAvatar} style={{position:'relative',marginBottom:12}}>
          <Avatar url={me.avatar_url} size={90}/>
          <View style={s.avatarEdit}><Ionicons name="camera-outline" size={14} color={C.bg}/></View>
        </TouchableOpacity>
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
      {stats&&(
        <View style={s.statsGrid}>
          {[
            ['beer-outline',      stats.total_visits,         'hospůdek',    C.amber],
            ['star-outline',      stats.avg_rating?.toFixed(1),'průměr',     C.star],
            ['ribbon-outline',    stats.firstlast_count,      'prvochlasty', C.purple],
            ['trophy-outline',    stats.challenges_done,      'výzev',       C.gold],
          ].map(([icon,val,label,color],i)=>(
            <View key={i} style={s.statsGridItem}>
              <Ionicons name={icon} size={24} color={color} style={{marginBottom:4}}/>
              <Text style={[s.statsGridNum,{color}]}>{val??'–'}</Text>
              <Text style={s.statsGridLabel}>{label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* My photos */}
      {photos.length>0&&(
        <View style={{marginHorizontal:16,marginBottom:16}}>
          <Text style={s.secLabel}>Moje fotky ({photos.length})</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            {photos.map((p,i)=>(
              <TouchableOpacity key={i} onPress={()=>setPv(i)} activeOpacity={0.85} style={{marginRight:8}}>
                <Image source={{uri:p.url}} style={{width:90,height:80,borderRadius:10}} resizeMode="cover"/>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}

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
        <TouchableOpacity style={s.settRow} onPress={logout}>
          <Ionicons name="log-out-outline" size={18} color={C.red}/>
          <Text style={{fontSize:15,fontWeight:'600',color:C.red}}>Odhlásit se</Text>
        </TouchableOpacity>
      </View>
      <Text style={{color:C.creamDim,fontSize:12,textAlign:'center',paddingBottom:10}}>Hospůdkobraní v1.2.1</Text>

      {pv!==null&&photos.length>0&&<PhotoViewer photos={photos} startIndex={pv} onClose={()=>setPv(null)}/>}
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

  useEffect(()=>{
    (async()=>{
      try{
        const [tk,ud]=await Promise.all([AsyncStorage.getItem('auth_token'),AsyncStorage.getItem('user_data')]);
        if(tk&&ud){
          setUser(JSON.parse(ud)); // Ihned použij lokálně uložená data
          // Pokus o obnovu ze serveru – pokud offline, ponech přihlášeného
          apiFetch('/auth/me')
            .then(u=>{ setUser(u); AsyncStorage.setItem('user_data',JSON.stringify(u)); })
            .catch(async()=>{
              const net=await NetInfo.fetch();
              if(net.isConnected){
                // Online, ale token je neplatný → odhlásit
                await AsyncStorage.multiRemove(['auth_token','user_data']);
                setUser(null);
              }
              // Offline → ponechat přihlášeného s lokálními daty
            });
        }
      }catch{}
      setBoot(false);
    })();
  },[]);

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
        {tab==='map'        && <MapScreen user={user}/>}
        {tab==='visits'     && <VisitsScreen user={user}/>}
        {tab==='community'  && <CommunityScreen user={user}/>}
        {tab==='challenges' && <ChallengesScreen user={user}/>}
        {tab==='profile'    && <ProfileScreen user={user} onLogout={()=>setUser(null)}/>}
      </View>
      <TabBar active={tab} onTab={setTab}/>
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
});