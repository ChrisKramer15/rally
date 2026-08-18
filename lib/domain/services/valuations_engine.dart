import '../models/enums.dart';
import '../models/ohlc_candle.dart';
import '../models/price_zone.dart';
import '../models/recommendation.dart';
import '../models/reward_risk_ratio.dart';
import 'i_valuations_engine.dart';

/// Concrete implementation of [IValuationsEngine] that analyzes supply/demand
/// zones and generates trade predictions using a clustering approach.
class ValuationsEngine implements IValuationsEngine {
  /// Minimum number of candles required for zone detection.
  static const int _minimumCandleCount = 5;

  /// Tolerance band as a fraction of price level for clustering rejections/bounces.
  /// e.g., 0.0075 means 0.75% of the average price level.
  static const double _clusteringTolerance = 0.0075;

  /// Minimum wick-to-body ratio to consider a candle as having a rejection or bounce.
  /// The relevant wick must be at least this fraction of the total candle range.
  static const double _wickSignificanceRatio = 0.3;

  @override
  List<PriceZone> identifySupplyZones(List<OhlcCandle> historicalData) {
    if (historicalData.length < _minimumCandleCount) {
      return [];
    }

    // Find candles with rejection patterns at highs:
    // A rejection occurs when the close is significantly below the high,
    // indicating selling pressure pushed the price back down.
    final rejectionPoints = <_PricePoint>[];

    for (final candle in historicalData) {
      final range = candle.high - candle.low;
      if (range <= 0) continue;

      // Upper wick = high - max(open, close)
      final upperWick = candle.high - _max(candle.open, candle.close);
      final wickRatio = upperWick / range;

      if (wickRatio >= _wickSignificanceRatio) {
        rejectionPoints.add(_PricePoint(
          level: candle.high,
          timestamp: candle.timestamp,
        ));
      }
    }

    return _clusterPointsIntoZones(
      points: rejectionPoints,
      zoneType: ZoneType.supply,
    );
  }

  @override
  List<PriceZone> identifyDemandZones(List<OhlcCandle> historicalData) {
    if (historicalData.length < _minimumCandleCount) {
      return [];
    }

    // Find candles with bounce patterns at lows:
    // A bounce occurs when the close is significantly above the low,
    // indicating buying pressure pushed the price back up.
    final bouncePoints = <_PricePoint>[];

    for (final candle in historicalData) {
      final range = candle.high - candle.low;
      if (range <= 0) continue;

      // Lower wick = min(open, close) - low
      final lowerWick = _min(candle.open, candle.close) - candle.low;
      final wickRatio = lowerWick / range;

      if (wickRatio >= _wickSignificanceRatio) {
        bouncePoints.add(_PricePoint(
          level: candle.low,
          timestamp: candle.timestamp,
        ));
      }
    }

    return _clusterPointsIntoZones(
      points: bouncePoints,
      zoneType: ZoneType.demand,
    );
  }

  /// Clusters price points into zones using a tolerance-based grouping approach.
  ///
  /// Points that are within [_clusteringTolerance] of each other's average level
  /// are grouped together. Only clusters with at least 2 touches form valid zones.
  List<PriceZone> _clusterPointsIntoZones({
    required List<_PricePoint> points,
    required ZoneType zoneType,
  }) {
    if (points.isEmpty) return [];

    // Sort points by price level for clustering
    final sorted = List<_PricePoint>.from(points)
      ..sort((a, b) => a.level.compareTo(b.level));

    final clusters = <List<_PricePoint>>[];
    var currentCluster = <_PricePoint>[sorted.first];

    for (var i = 1; i < sorted.length; i++) {
      final clusterAvg =
          currentCluster.map((p) => p.level).reduce((a, b) => a + b) /
              currentCluster.length;
      final tolerance = clusterAvg * _clusteringTolerance;

      if ((sorted[i].level - clusterAvg).abs() <= tolerance) {
        currentCluster.add(sorted[i]);
      } else {
        clusters.add(currentCluster);
        currentCluster = [sorted[i]];
      }
    }
    clusters.add(currentCluster);

    // Convert clusters with ≥2 touches into PriceZone objects
    final zones = <PriceZone>[];
    for (final cluster in clusters) {
      if (cluster.length < 2) continue;

      final levels = cluster.map((p) => p.level).toList();
      final timestamps = cluster.map((p) => p.timestamp).toList();

      final minLevel = levels.reduce(_min);
      final maxLevel = levels.reduce(_max);
      final avgLevel = levels.reduce((a, b) => a + b) / levels.length;

      // Zone bounds: use a tolerance band around the cluster range
      final halfBand = avgLevel * _clusteringTolerance / 2;
      final lowerBound = minLevel - halfBand;
      final upperBound = maxLevel + halfBand;

      // First identified is the earliest timestamp in the cluster
      timestamps.sort();
      final firstIdentified = timestamps.first;

      zones.add(PriceZone(
        upperBound: upperBound,
        lowerBound: lowerBound,
        type: zoneType,
        touchCount: cluster.length,
        firstIdentified: firstIdentified,
      ));
    }

    return zones;
  }

  @override
  List<Recommendation> generateRecommendations({
    required String symbol,
    required double currentPrice,
    required List<PriceZone> supplyZones,
    required List<PriceZone> demandZones,
  }) {
    final recommendations = <Recommendation>[];
    final now = DateTime.now();

    // Check demand zones for buy opportunities
    for (final zone in demandZones) {
      // Check if current price is within 1% of the zone's upperBound
      final distance = (currentPrice - zone.upperBound).abs();
      final threshold = zone.upperBound * 0.01;

      if (distance <= threshold) {
        final entry = currentPrice;
        final stopLoss = zone.lowerBound;
        final zoneHeight = zone.upperBound - zone.lowerBound;
        final target = entry + zoneHeight;

        // Filter zero/negative values
        if (entry <= 0 || stopLoss <= 0 || target <= 0) continue;
        // Avoid zero denominator
        if (entry == stopLoss) continue;

        final rrResult = RewardRiskRatio.calculate(
          direction: TradeDirection.buy,
          entryPrice: entry,
          targetPrice: target,
          stopLossPrice: stopLoss,
        );

        if (rrResult.isFailure) continue;

        final rr = rrResult.value;
        if (rr.value <= 1.00) continue;

        recommendations.add(Recommendation(
          symbol: symbol,
          assetName: symbol,
          direction: TradeDirection.buy,
          category: TradeCategory.dayTrade,
          entryPrice: entry,
          targetPrice: target,
          stopLossPrice: stopLoss,
          rewardRisk: rr,
          generatedAt: now,
          status: RecommendationStatus.active,
        ));
      }
    }

    // Check supply zones for short opportunities
    for (final zone in supplyZones) {
      // Check if current price is within 1% of the zone's lowerBound
      final distance = (currentPrice - zone.lowerBound).abs();
      final threshold = zone.lowerBound * 0.01;

      if (distance <= threshold) {
        final entry = currentPrice;
        final stopLoss = zone.upperBound;
        final zoneHeight = zone.upperBound - zone.lowerBound;
        final target = entry - zoneHeight;

        // Filter zero/negative values
        if (entry <= 0 || stopLoss <= 0 || target <= 0) continue;
        // Avoid zero denominator
        if (entry == stopLoss) continue;

        final rrResult = RewardRiskRatio.calculate(
          direction: TradeDirection.short_,
          entryPrice: entry,
          targetPrice: target,
          stopLossPrice: stopLoss,
        );

        if (rrResult.isFailure) continue;

        final rr = rrResult.value;
        if (rr.value <= 1.00) continue;

        recommendations.add(Recommendation(
          symbol: symbol,
          assetName: symbol,
          direction: TradeDirection.short_,
          category: TradeCategory.dayTrade,
          entryPrice: entry,
          targetPrice: target,
          stopLossPrice: stopLoss,
          rewardRisk: rr,
          generatedAt: now,
          status: RecommendationStatus.active,
        ));
      }
    }

    // Filter incomplete recommendations (missing entry, stop, or target)
    final filtered = recommendations.where((r) =>
        r.entryPrice > 0 && r.stopLossPrice > 0 && r.targetPrice > 0).toList();

    // Sort by R:R descending
    filtered.sort((a, b) => b.rewardRisk.value.compareTo(a.rewardRisk.value));

    return filtered;
  }

  @override
  RewardRiskRatio calculateRewardRisk({
    required TradeDirection direction,
    required double entryPrice,
    required double targetPrice,
    required double stopLossPrice,
  }) {
    final result = RewardRiskRatio.calculate(
      direction: direction,
      entryPrice: entryPrice,
      targetPrice: targetPrice,
      stopLossPrice: stopLossPrice,
    );

    return result.fold(
      onSuccess: (ratio) => ratio,
      onFailure: (error) => throw ArgumentError(error),
    );
  }

  @override
  TradeCategory categorize({
    required double entryPrice,
    required double targetPrice,
    required TimeDuration timeframe,
  }) {
    switch (timeframe) {
      case TimeDuration.oneMin:
      case TimeDuration.fiveMin:
      case TimeDuration.fifteenMin:
      case TimeDuration.thirtyMin:
      case TimeDuration.oneHour:
      case TimeDuration.fourHour:
      case TimeDuration.eightHour:
      case TimeDuration.twelveHour:
        return TradeCategory.dayTrade;
      case TimeDuration.twentyFourHour:
      case TimeDuration.oneWeek:
        return TradeCategory.swingTrade;
      case TimeDuration.oneMonth:
      case TimeDuration.oneQuarter:
      case TimeDuration.oneYear:
      case TimeDuration.allTime:
        return TradeCategory.positionTrade;
    }
  }

  @override
  bool isCompleted(Recommendation recommendation, double currentPrice) {
    switch (recommendation.direction) {
      case TradeDirection.buy:
        return currentPrice >= recommendation.targetPrice ||
            currentPrice <= recommendation.stopLossPrice;
      case TradeDirection.short_:
        return currentPrice <= recommendation.targetPrice ||
            currentPrice >= recommendation.stopLossPrice;
    }
  }

  double _min(double a, double b) => a < b ? a : b;
  double _max(double a, double b) => a > b ? a : b;
}

/// Internal helper representing a price level at a specific time.
class _PricePoint {
  final double level;
  final DateTime timestamp;

  const _PricePoint({
    required this.level,
    required this.timestamp,
  });
}
