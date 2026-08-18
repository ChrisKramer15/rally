import 'package:equatable/equatable.dart';

/// Real-time price update from WebSocket.
class PriceUpdate extends Equatable {
  final String symbol;
  final double price;
  final double dailyHigh;
  final double dailyLow;
  final double volume;
  final double percentageChange;
  final DateTime timestamp;

  const PriceUpdate({
    required this.symbol,
    required this.price,
    required this.dailyHigh,
    required this.dailyLow,
    required this.volume,
    required this.percentageChange,
    required this.timestamp,
  });

  @override
  List<Object?> get props => [
        symbol,
        price,
        dailyHigh,
        dailyLow,
        volume,
        percentageChange,
        timestamp,
      ];
}
