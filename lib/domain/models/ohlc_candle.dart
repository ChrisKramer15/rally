import 'package:equatable/equatable.dart';

/// Represents a single OHLC (Open, High, Low, Close) candle.
class OhlcCandle extends Equatable {
  final DateTime timestamp;
  final double open;
  final double high;
  final double low;
  final double close;
  final double volume;

  const OhlcCandle({
    required this.timestamp,
    required this.open,
    required this.high,
    required this.low,
    required this.close,
    required this.volume,
  });

  @override
  List<Object?> get props => [timestamp, open, high, low, close, volume];
}
