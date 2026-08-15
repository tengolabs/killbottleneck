import {
  Target, Heart, Briefcase, GraduationCap, Dumbbell, Wallet,
  PiggyBank, BookOpen, Rocket, Plane, Home, Users, Brain, Zap,
  TrendingUp, Award, Star, Flag, Compass, Coffee, Sun, Moon,
  Calendar, Clock, Map, MapPin, Trophy, Sprout, Leaf, Flame,
  Mountain, Ship, Car, Bike, Music, Camera, Code, Palette,
  PenTool, Mic, Gift, Globe, Shield, Anchor, Feather, Bell,
} from 'lucide-react';

const iconMap = {
  Target, Heart, Briefcase, GraduationCap, Dumbbell, Wallet,
  PiggyBank, BookOpen, Rocket, Plane, Home, Users, Brain, Zap,
  TrendingUp, Award, Star, Flag, Compass, Coffee, Sun, Moon,
  Calendar, Clock, Map, MapPin, Trophy, Sprout, Leaf, Flame,
  Mountain, Ship, Car, Bike, Music, Camera, Code, Palette,
  PenTool, Mic, Gift, Globe, Shield, Anchor, Feather, Bell,
};

export default function DynamicIcon({ name, ...props }) {
  // vlastní klíč, ne prototyp — name z dat mapy může být „constructor" apod.
  const IconComponent = (Object.prototype.hasOwnProperty.call(iconMap, name) && iconMap[name]) || Target;
  return <IconComponent {...props} />;
}