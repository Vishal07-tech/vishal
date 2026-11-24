import { Platform } from 'react-native';

export const color = {
  bg: '#0A0A0B',
  surface: '#121214',
  raised: '#19191D',
  border: '#26262B',
  borderStrong: '#33333A',
  text: '#F3F2EF',
  muted: '#9A9AA2',
  faint: '#6B6B74',
  accent: '#FFA51F',
  accentInk: '#141006',
  good: '#7BD8A4',
  goodBg: '#152219',
  danger: '#E8735E',
};

export const space = { xs: 4, sm: 8, md: 12, lg: 18, xl: 24, xxl: 36 };

export const radius = { card: 16, chip: 8, pill: 999, mark: 3 };

export const type = {
  sans: 'IBMPlexSans_400Regular',
  sansMedium: 'IBMPlexSans_500Medium',
  sansSemi: 'IBMPlexSans_600SemiBold',
  sansBold: 'IBMPlexSans_700Bold',
  serif: 'SourceSerif4_400Regular',
  serifSemi: 'SourceSerif4_600SemiBold',
};

export const hitSlop = { top: 10, bottom: 10, left: 10, right: 10 };

export const hairline = Platform.select({ ios: 0.7, default: 1 }) as number;
