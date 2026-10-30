import type { LatLng } from '@zandu/domain';
import { Bike, House } from 'lucide-react-native';
import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { GOOGLE_MAPS_ENABLED } from '../config';
import { colors, radius } from '../theme';
import { MapTiles } from './MapTiles';

type Props = ComponentProps<typeof MapTiles>;

/**
 * Carte Google Maps (Android et iPhone) : déplacer, zoomer, suivre le livreur en direct. Les deux
 * repères (livreur, porte du client) restent dans le cadre ; un toucher choisit un point quand
 * `onPick` est fourni. Sans clé Google dans la version construite, la petite carte en tuiles
 * prend le relais (APK de démonstration, essais).
 */
export function LiveMap(props: Props) {
  if (!GOOGLE_MAPS_ENABLED) return <MapTiles {...props} />;
  return <GoogleMap {...props} />;
}

function GoogleMap({
  lat,
  lng,
  pin = 'rider',
  other,
  zoom = 16,
  height = 180,
  onPick,
  label,
  testID,
}: Props) {
  const map = useRef<MapView>(null);
  const [ready, setReady] = useState(false);
  // Les repères dessinés sont figés après leur premier rendu (fluidité sur les petits Android).
  const [frozen, setFrozen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setFrozen(true), 800);
    return () => clearTimeout(timer);
  }, []);

  const center: LatLng = { lat, lng };
  const otherLat = other?.point.lat;
  const otherLng = other?.point.lng;
  useEffect(() => {
    if (!ready || !map.current) return;
    if (otherLat !== undefined && otherLng !== undefined) {
      map.current.fitToCoordinates(
        [
          { latitude: lat, longitude: lng },
          { latitude: otherLat, longitude: otherLng },
        ],
        { edgePadding: { top: 48, right: 48, bottom: 48, left: 48 }, animated: true },
      );
    } else {
      map.current.animateCamera(
        { center: { latitude: lat, longitude: lng }, zoom },
        { duration: 600 },
      );
    }
  }, [ready, lat, lng, otherLat, otherLng, zoom]);

  return (
    <View style={[styles.frame, { height }]} testID={testID} accessibilityLabel={label ?? 'Carte'}>
      <MapView
        ref={map}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        customMapStyle={DARK}
        initialCamera={{ center: { latitude: lat, longitude: lng }, zoom, heading: 0, pitch: 0 }}
        onMapReady={() => setReady(true)}
        onPress={
          onPick
            ? (e) =>
                onPick({
                  lat: e.nativeEvent.coordinate.latitude,
                  lng: e.nativeEvent.coordinate.longitude,
                })
            : undefined
        }
        toolbarEnabled={false}
        showsCompass={false}
        loadingEnabled
        loadingBackgroundColor={colors.surfaceRaised}
      >
        <Pin point={center} kind={pin} frozen={frozen} />
        {other ? <Pin point={other.point} kind={other.pin} frozen={frozen} /> : null}
      </MapView>
    </View>
  );
}

function Pin({ point, kind, frozen }: { point: LatLng; kind: 'rider' | 'home'; frozen: boolean }) {
  const Icon = kind === 'rider' ? Bike : House;
  return (
    <Marker
      coordinate={{ latitude: point.lat, longitude: point.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={!frozen || Platform.OS === 'ios'}
    >
      <View style={[styles.pin, kind === 'home' && styles.home]}>
        <Icon color={kind === 'home' ? '#fff' : colors.onBrand} size={20} strokeWidth={2.2} />
      </View>
    </Marker>
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
  pin: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brand,
    borderWidth: 3,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  home: { backgroundColor: colors.danger },
});

/** Style sombre, accordé au thème de l'application (rues lisibles, points d'intérêt discrets). */
const DARK = [
  { elementType: 'geometry', stylers: [{ color: '#1c2230' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9b9fa7' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0b0e15' }] },
  { featureType: 'poi', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2b3242' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#343c4f' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#445033' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#10252b' }] },
];
