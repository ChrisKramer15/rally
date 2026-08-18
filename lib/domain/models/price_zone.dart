import 'package:equatable/equatable.dart';

import 'enums.dart';

/// A supply or demand zone identified by the valuations engine.
class PriceZone extends Equatable {
  final double upperBound;
  final double lowerBound;
  final ZoneType type;
  final int touchCount;
  final DateTime firstIdentified;

  const PriceZone({
    required this.upperBound,
    required this.lowerBound,
    required this.type,
    required this.touchCount,
    required this.firstIdentified,
  });

  @override
  List<Object?> get props => [
        upperBound,
        lowerBound,
        type,
        touchCount,
        firstIdentified,
      ];
}
