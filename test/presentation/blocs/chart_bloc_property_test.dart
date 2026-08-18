import 'package:flutter_test/flutter_test.dart';
import 'package:kiri_check/kiri_check.dart';
import 'package:mocktail/mocktail.dart';
import 'package:rally/data/repositories/market_data_repository.dart';
import 'package:rally/domain/models/enums.dart';
import 'package:rally/domain/models/ohlc_candle.dart';
import 'package:rally/presentation/blocs/chart_bloc.dart';

// --- Mocks ---

class MockMarketDataRepository extends Mock implements MarketDataRepository {}

/// Feature: stock-trading-valuations-engine
/// Property-based tests for ChartBLoC chart type independence from time duration
void main() {
  setUpAll(() {
    registerFallbackValue(TimeDuration.twentyFourHour);
  });

  group(
      'Feature: stock-trading-valuations-engine, '
      'Property 15: Chart type independence from time duration', () {
    // **Validates: Requirements 6.5**
    //
    // For any chart type selection (line or candlestick) and any time duration
    // change, the chart type SHALL remain unchanged after the duration is updated.

    late MockMarketDataRepository mockRepo;

    setUp(() {
      mockRepo = MockMarketDataRepository();
    });

    /// Helper to create sample OHLC candles for mock data.
    List<OhlcCandle> _sampleCandles() {
      return List.generate(
        10,
        (i) => OhlcCandle(
          timestamp: DateTime(2024, 1, 1).add(Duration(hours: i)),
          open: 100.0 + i,
          high: 105.0 + i,
          low: 95.0 + i,
          close: 102.0 + i,
          volume: 1000.0 + i * 100,
        ),
      );
    }

    property(
        'chart type remains unchanged after any duration change regardless of initial chart type',
        () {
      forAll(
        // Generate a pair: (chartTypeIndex, timeDurationIndex)
        combine2(
          integer(min: 0, max: ChartType.values.length - 1),
          integer(min: 0, max: TimeDuration.values.length - 1),
        ),
        (pair) async {
          final chartTypeIndex = pair.$1;
          final durationIndex = pair.$2;

          final selectedChartType = ChartType.values[chartTypeIndex];
          final newDuration = TimeDuration.values[durationIndex];

          // Set up the mock to return valid data for any symbol/duration
          when(() => mockRepo.getOhlcData(
                symbol: any(named: 'symbol'),
                duration: any(named: 'duration'),
              )).thenAnswer((_) async => _sampleCandles());

          // Create the BLoC
          final bloc = ChartBloc(repository: mockRepo);

          // Load initial chart data
          bloc.add(const LoadChart('AAPL'));
          await bloc.stream.firstWhere((s) => s is ChartLoaded);

          // Toggle to desired chart type if needed (default is line)
          if (selectedChartType == ChartType.candlestick) {
            bloc.add(const ToggleChartType());
            await bloc.stream.firstWhere((s) =>
                s is ChartLoaded &&
                s.chartType == ChartType.candlestick);
          }

          // Verify the chart type before changing duration
          expect(bloc.currentChartType, equals(selectedChartType),
              reason:
                  'Chart type should be $selectedChartType before duration change');

          // Change the duration
          bloc.add(ChangeDuration(newDuration));
          await bloc.stream.firstWhere((s) => s is! ChartLoading);

          // Assert: chart type remains unchanged after duration change
          expect(bloc.currentChartType, equals(selectedChartType),
              reason:
                  'Chart type should remain $selectedChartType after changing duration to $newDuration, '
                  'but was ${bloc.currentChartType}');

          // Also verify the emitted state carries the correct chart type
          final currentState = bloc.state;
          if (currentState is ChartLoaded) {
            expect(currentState.chartType, equals(selectedChartType),
                reason:
                    'ChartLoaded state should carry chartType=$selectedChartType after duration change');
          } else if (currentState is InsufficientData) {
            expect(currentState.chartType, equals(selectedChartType),
                reason:
                    'InsufficientData state should carry chartType=$selectedChartType after duration change');
          } else if (currentState is ChartError) {
            expect(currentState.chartType, equals(selectedChartType),
                reason:
                    'ChartError state should carry chartType=$selectedChartType after duration change');
          }

          await bloc.close();
        },
        maxExamples: 100,
      );
    });
  });
}
