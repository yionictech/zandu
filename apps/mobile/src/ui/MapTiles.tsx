import { tilesAround, tileUrl, TILE_SIZE } from '@zandu/domain';
import { Image } from 'expo-image';
import { Bike } from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { MAP_ATTRIBUTION, MAP_TILES } from '../config';
import { colors, radius } from '../theme';
import { Text } from './Text';

/**
 * Petite carte centrée sur le livreur : quelques tuiles posées côte à côte, sans module natif
 * ni bibliothèque de cartes (léger en 3G, marche aussi sur la version web).
 */
export function MapTiles({
  lat,
  lng,
  zoom = 16,
  height = 180,
  testID,
}: {
  lat: number;
  lng: number;
  zoom?: number;
  height?: number;
  testID?: string;
}) {
  const [width, setWidth] = useState(0);
  const tiles = width ? tilesAround(lat, lng, zoom, width, height) : [];
  return (
    <View
      style={[styles.frame, { height }]}
      onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}
      testID={testID}
      accessibilityLabel="Position du livreur"
    >
      {tiles.map((t) => (
        <Image
          key={`${t.z}-${t.x}-${t.y}`}
          source={{ uri: tileUrl(MAP_TILES, t) }}
          style={[styles.tile, { left: t.left, top: t.top }]}
          cachePolicy="memory-disk"
        />
      ))}
      <View style={[styles.marker, { left: width / 2 - 18, top: height / 2 - 18 }]}>
        <Bike color={colors.onBrand} size={20} strokeWidth={2.2} />
      </View>
      <Text style={styles.attribution}>{MAP_ATTRIBUTION}</Text>
    </View>
  );
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
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brand,
    borderWidth: 3,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
