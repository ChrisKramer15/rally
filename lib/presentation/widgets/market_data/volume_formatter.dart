/// Formats a volume value into a human-readable string with appropriate suffix.
///
/// Formatting rules:
/// - volume >= 1,000,000,000 → "X.XXB"
/// - volume >= 1,000,000 → "X.XXM"
/// - volume >= 1,000 → "X.XXK"
/// - volume < 1,000 → "X.XX"
String formatVolume(double volume) {
  if (volume >= 1000000000) {
    return '${(volume / 1000000000).toStringAsFixed(2)}B';
  } else if (volume >= 1000000) {
    return '${(volume / 1000000).toStringAsFixed(2)}M';
  } else if (volume >= 1000) {
    return '${(volume / 1000).toStringAsFixed(2)}K';
  } else {
    return volume.toStringAsFixed(2);
  }
}
