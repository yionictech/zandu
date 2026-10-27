import {
  latLngAtOffset,
  offsetFromCenter,
  tilesAround,
  tileUrl,
  TILE_SIZE,
  type LatLng,
} from '@zandu/domain';
import { Image } from 'expo-image';
import { Bike, House } from 'lucide-react-native';
import { useRef, useState, type ComponentRef } from 'react';
import { Pressable, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { MAP_ATTRIBUTION, MAP_TILES } from '../config';
import { colors, radius } from '../theme';
import { Text } from './Text';

type Pin = 'rider' | 'home';
const PIN = 36;

/**
 * Petite carte sans module natif ni bibliothèque de cartes (léger en 3G, marche aussi sur la
 * version web) : quelques tuiles posées côte à côte, un repère au centre et, s'il tient dans le
 * cadre, un second repère (la maison du client vue du livreur, ou l'inverse). Avec `onPick`, un
 * toucher sur la carte donne le point touché : le client ajuste ainsi l'emplacement de sa porte.
 */
export function MapTiles({
  lat,
  lng,
  pin = 'rider',
  other,
  zoom: maxZoom = 16,
  height = 180,
  onPick,
  label,
  testID,
}: {
  lat: number;
  lng: number;
  pin?: Pin;
  /** Second repère, montré seulement s'il tient dans le cadre (le zoom recule pour l'y faire tenir). */
  other?: { point: LatLng; pin: Pin } | null;
  zoom?: number;
  height?: number;
  onPick?: (point: LatLng) => void;
  label?: string;
  testID?: string;
}) {
  const [width, setWidth] = useState(0);
  const frame = useRef<ComponentRef<typeof View>>(null);
  const center = { lat, lng };
  const zoom = other && width ? fitZoom(center, other.point, maxZoom, width, height) : maxZoom;
  const tiles = width ? tilesAround(lat, lng, zoom, width, height) : [];
  const offset = other && width ? offsetFromCenter(center, other.point, zoom) : null;
  const showOther =
    offset &&
    Math.abs(offset.dx) < width / 2 - PIN / 2 &&
    Math.abs(offset.dy) < height / 2 - PIN / 2;
  const emit = (x: number, y: number) => {
    if (Number.isFinite(x) && Number.isFinite(y))
      onPick?.(latLngAtOffset(center, zoom, x - width / 2, y - height / 2));
  };
  // Point touché dans le cadre ; sur la version web, il faut le calculer depuis la page.
  const pick = (e: GestureResponderEvent) => {
    const { locationX, locationY, pageX, pageY } = e.nativeEvent;
    if (Number.isFinite(locationX) && Number.isFinite(locationY)) return emit(locationX, locationY);
    frame.current?.measure((_x, _y, _w, _h, left, top) => emit(pageX - left, pageY - top));
  };
  return (
    <Pressable
      ref={frame}
      style={[styles.frame, { height }]}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      disabled={!onPick}
      onPress={pick}
      testID={testID}
      accessibilityLabel={label ?? 'Carte'}
    >
      {tiles.map((t) => (
        <Image
          key={`${t.z}-${t.x}-${t.y}`}
          source={{ uri: tileUrl(MAP_TILES, t) }}
          style={[styles.tile, { left: t.left, top: t.top }]}
          pointerEvents="none"
          cachePolicy="memory-disk"
        />
      ))}
      {showOther && offset && other ? (
        <Marker pin={other.pin} left={width / 2 + offset.dx} top={height / 2 + offset.dy} />
      ) : null}
      <Marker pin={pin} left={width / 2} top={height / 2} />
      <Text style={styles.attribution}>{MAP_ATTRIBUTION}</Text>
    </Pressable>
  );
}

function Marker({ pin, left, top }: { pin: Pin; left: number; top: number }) {
  const Icon = pin === 'rider' ? Bike : House;
  return (
    <View
      pointerEvents="none"
      style={[
        styles.marker,
        pin === 'home' && styles.home,
        { left: left - PIN / 2, top: top - PIN / 2 },
      ]}
    >
      <Icon color={pin === 'home' ? '#fff' : colors.onBrand} size={20} strokeWidth={2.2} />
    </View>
  );
}

/** Le zoom le plus proche (16 au plus, 11 au moins) où les deux repères tiennent dans le cadre. */
function fitZoom(center: LatLng, point: LatLng, max: number, width: number, height: number) {
  for (let z = max; z > 11; z--) {
    const { dx, dy } = offsetFromCenter(center, point, z);
    if (Math.abs(dx) < width / 2 - PIN && Math.abs(dy) < height / 2 - PIN) return z;
  }
  return 11;
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tile: { position: 'absolute', width: TILE_SIZE, height: TILE_SIZE },
  marker: {
    position: 'absolute',
    width: PIN,
    height: PIN,
    borderRadius: PIN / 2,
    backgroundColor: colors.brand,
    borderWidth: 3,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  home: { backgroundColor: colors.danger },
  attribution: {
    position: 'absolute',
    right: 4,
    bottom: 2,
    fontSize: 9,
    color: '#333',
    backgroundColor: 'rgba(255,255,255,0.7)',
    paddingHorizontal: 3,
  },
});
