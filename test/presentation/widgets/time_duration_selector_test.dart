import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:rally/domain/models/enums.dart';
import 'package:rally/domain/models/ohlc_candle.dart';
import 'package:rally/presentation/blocs/chart_bloc.dart';
import 'package:rally/presentation/theme/neon_theme.dart';
import 'package:rally/presentation/widgets/time_duration_selector.dart';

import 'package:rally/data/repositories/market_data_repository.dart';

class MockMarketDataRepository extends Mock implements MarketDataRepository {}

void main() {
  late MockMarketDataRepository mockRepo;
  late ChartBloc chartBloc;

  setUpAll(() {
    registerFallbackValue(TimeDuration.twentyFourHour);
  });

  setUp(() {
    mockRepo = MockMarketDataRepository();
    chartBloc = ChartBloc(repository: mockRepo);
  });

  tearDown(() async {
    await chartBloc.close();
  });

  Widget buildTestWidget({ChartBloc? bloc}) {
    return MaterialApp(
      theme: NeonTheme.darkTheme,
      home: Scaffold(
        body: BlocProvider<ChartBloc>.value(
          value: bloc ?? chartBloc,
          child: const TimeDurationSelector(),
        ),
      ),
    );
  }

  List<OhlcCandle> sampleCandles() {
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

  group('TimeDurationSelector', () {
    testWidgets('displays all 14 time duration options', (tester) async {
      // Use a wide surface so all chips are visible without scrolling
      tester.view.physicalSize = const Size(1600, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(buildTestWidget());
      await tester.pump();

      // All 14 TimeDuration labels should be present
      for (final duration in TimeDuration.values) {
        expect(find.text(duration.label), findsOneWidget);
      }
    });

    testWidgets('defaults to 24hr selection on initial display', (tester) async {
      tester.view.physicalSize = const Size(1600, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await tester.pumpWidget(buildTestWidget());
      await tester.pump();

      // The chartBloc's default is twentyFourHour
      expect(chartBloc.currentDuration, TimeDuration.twentyFourHour);
      expect(find.text('24 hr'), findsOneWidget);
    });

    testWidgets('dispatches ChangeDuration event on tap', (tester) async {
      tester.view.physicalSize = const Size(1600, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      when(() => mockRepo.getOhlcData(
            symbol: any(named: 'symbol'),
            duration: any(named: 'duration'),
          )).thenAnswer((_) async => sampleCandles());

      await tester.pumpWidget(buildTestWidget());
      await tester.pump();

      // Tap the "1 hr" chip
      await tester.tap(find.text('1 hr'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      // The bloc should now have the selected duration updated
      expect(chartBloc.currentDuration, TimeDuration.oneHour);
    });

    testWidgets('shows loading indicator during ChartLoading state',
        (tester) async {
      tester.view.physicalSize = const Size(1600, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      when(() => mockRepo.getOhlcData(
            symbol: any(named: 'symbol'),
            duration: any(named: 'duration'),
          )).thenAnswer(
              (_) => Future.delayed(const Duration(seconds: 5), sampleCandles));

      // Load chart to trigger loading state
      chartBloc.add(const LoadChart('AAPL'));

      await tester.pumpWidget(buildTestWidget());
      await tester.pump(); // Allow bloc to emit ChartLoading

      // Should show a CircularProgressIndicator
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('displays error message on ChartError state', (tester) async {
      tester.view.physicalSize = const Size(1600, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      when(() => mockRepo.getOhlcData(
            symbol: any(named: 'symbol'),
            duration: any(named: 'duration'),
          )).thenThrow(Exception('Network error'));

      // Load chart to trigger error state
      chartBloc.add(const LoadChart('AAPL'));

      await tester.pumpWidget(buildTestWidget());
      await tester.pump(); // Process event
      await tester.pump(); // Rebuild after state change

      // Should show error message
      expect(find.text('Failed to load chart data'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsOneWidget);
    });

    testWidgets('maintains chart type across duration changes', (tester) async {
      tester.view.physicalSize = const Size(1600, 800);
      tester.view.devicePixelRatio = 1.0;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      when(() => mockRepo.getOhlcData(
            symbol: any(named: 'symbol'),
            duration: any(named: 'duration'),
          )).thenAnswer((_) async => sampleCandles());

      // Load chart
      chartBloc.add(const LoadChart('AAPL'));
      await tester.pumpWidget(buildTestWidget());
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));

      // Toggle to candlestick
      chartBloc.add(const ToggleChartType());
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 100));
      expect(chartBloc.currentChartType, ChartType.candlestick);

      // Change duration by tapping "1 wk"
      await tester.tap(find.text('1 wk'));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      // Chart type should still be candlestick
      expect(chartBloc.currentChartType, ChartType.candlestick);
    });
  });
}
