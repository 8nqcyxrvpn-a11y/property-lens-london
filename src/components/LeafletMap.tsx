import { useEffect, useRef } from "react";

/* Leaflet is loaded from a CDN at runtime (browser only), so the server render never touches `window`. */
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type L = any;
let loading: Promise<L> | null = null;

function loadLeaflet(): Promise<L> {
  const w = window as unknown as { L?: L };
  if (w.L) return Promise.resolve(w.L);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = LEAFLET_CSS;
      document.head.appendChild(css);
      const script = document.createElement("script");
      script.src = LEAFLET_JS;
      script.onload = () => resolve((window as unknown as { L: L }).L);
      script.onerror = () => reject(new Error("The map library could not be loaded."));
      document.head.appendChild(script);
    });
  }
  return loading;
}

export interface MapPoint {
  id: string;
  lat: number;
  lon: number;
  color: string;
  label: string;
}

export interface MapPin {
  lat: number;
  lon: number;
  label: string;
}

interface Props {
  points: MapPoint[];
  pins?: MapPin[];
  center?: [number, number];
  zoom?: number;
  radiusM?: number | undefined;
  selected?: string | null | undefined;
  onSelect?: (id: string) => void;
  className?: string;
}

function cssColor(value: string): string {
  const m = /^var\((--[\w-]+)\)$/.exec(value);
  return m && m[1] ? getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || "#555" : value;
}

export function LeafletMap({ points, pins = [], center, zoom = 14, radiusM, selected, onSelect, className }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L>(null);
  const layer = useRef<L>(null);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then((Leaflet) => {
      if (cancelled || !el.current || map.current) return;
      map.current = Leaflet.map(el.current, { scrollWheelZoom: true, preferCanvas: true }).setView(
        center ?? [51.535, -0.15],
        zoom,
      );
      Leaflet.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; CARTO',
        maxZoom: 19,
      }).addTo(map.current);
      layer.current = Leaflet.layerGroup().addTo(map.current);
      draw(Leaflet);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function draw(Leaflet: L) {
    if (!layer.current) return;
    layer.current.clearLayers();
    if (center && radiusM) {
      Leaflet.circle(center, { radius: radiusM, color: cssColor("var(--fair)"), weight: 1, fillOpacity: 0.04 }).addTo(
        layer.current,
      );
    }
    for (const p of points) {
      const isSel = p.id === selected;
      const marker = Leaflet.circleMarker([p.lat, p.lon], {
        radius: isSel ? 9 : 5,
        color: isSel ? cssColor("var(--foreground)") : "#ffffff",
        weight: isSel ? 3 : 1,
        fillColor: cssColor(p.color),
        fillOpacity: 0.9,
      });
      marker.bindTooltip(p.label, { direction: "top" });
      if (onSelect) marker.on("click", () => onSelect(p.id));
      marker.addTo(layer.current);
    }
    for (const pin of pins) {
      Leaflet.marker([pin.lat, pin.lon], { title: pin.label }).bindTooltip(pin.label).addTo(layer.current);
    }
  }

  useEffect(() => {
    const Leaflet = (window as unknown as { L?: L }).L;
    if (!Leaflet || !map.current) return;
    draw(Leaflet);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, pins, selected, radiusM, center?.[0], center?.[1]]);

  useEffect(() => {
    if (map.current && center) map.current.setView(center, map.current.getZoom() < 13 ? zoom : map.current.getZoom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.[0], center?.[1]]);

  return <div ref={el} className={className} role="region" aria-label="Map of homes" />;
}
