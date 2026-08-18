import 'package:bloc_test/bloc_test.dart';
import 'package:flutter/material.dart';
import 'package:flutter_bloc/flutter_bloc.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';
import 'package:rally/domain/models/enums.dart';
import 'package:rally/domain/models/ohlc_candle.dart';
import 'package:rally/presentation/blocs/chart_bloc.dart';
import 'package:rally/presentation/widgets/chart_widget.dart';

// --- Mock BLoC ---

class MockChartBloc extends MockBloc<ChartEvent, ChartState>
    implements ChartBloc {}

/// Helper to generate valid sample candles.
List<OhlcCandle> sampleCandles({int count = 10, bool bullish = true}) {
  return List.generate(
    count,
    (i) => OhlcCandle(
      timestamp: DateTime(2024, 1, 1).add(Duration(hours: i)),
      open: bullish ? 100.0 + i : 102.0 + i,
      high: 105.0 + i,
      low: 95.0 + i,
      close: bullish ? 102.0 + i : 100.0 + i,
      volume: 1000.0 + i * 100,
    ),
  );
}

/// Helper to wrap the ChartWidget with a mock BLoC for testing.
Widget buildTestWidget(MockChartBloc bloc) {
  return MaterialApp(
    theme: ThemeData.dark(),
    home: Scaffold(
      body: BlocProvider<ChartBloc>.value(
        value: bloc,
        child: const SizedBox(
          width: 400,
          height: 300,
          child: ChartWidget(animationDuration: Duration.zero),
        ),
      ),
    ),
  );
}

void main() {
  late MockChartBloc mockBloc;

  setUp(() {
    mockBloc = MockChartBloc();
  });

  tearDown(() {
    mockBloc.close();
  });

  group('ChartWidget - InsufficientData state', () {
    testWidgets('displays insufficient data message when < 2 data points',
        (tester) async {
      when(() => mockBloc.state).thenReturn(const InsufficientData(
        chartType: ChartType.line,
        duration: TimeDuration.twentyFourHour,
      ));

      await tester.pumpWidget(buildTestWidget(mockBloc));

      expect(find.text('Insufficient data'), findsOneWidget);
      expect(find.text('Not enough data points to render the chart.'),
          findsOneWidget);
    });
  });

  group('ChartWidget - ChartError state', () {
    testWidgets('displays error message on chart error', (tester) async {
      when(() => mockBloc.state).thenReturn(const ChartError(
        message: 'Exception: Network error',
        chartType: ChartType.line,
        duration: TimeDuration.twentyFourHour,
      ));

      await tester.pumpWidget(buildTestWidget(mockBloc));

      expect(find.text('Chart Error'), findsOneWidget);
      expect(find.text('Exception: Network error'), findsOneWidget);
    });
  });

  group('ChartWidget - ChartInitial state', () {
    testWidgets('shows initial message when no data loaded', (tester) async {
      when(() => mockBloc.state).thenReturn(const ChartInitial());

      await tester.pumpWidget(buildTestWidget(mockBloc));

      expect(find.text('Select an asset to view chart'), findsOneWidget);
    });
  });

  group('ChartWidget - ChartLoading state', () {
    testWidgets('shows loading indicator during chart loading', (tester) async {
      when(() => mockBloc.state).thenReturn(const ChartLoading(
        currentType: ChartType.line,
        duration: TimeDuration.twentyFourHour,
      ));

      await tester.pumpWidget(buildTestWidget(mockBloc));

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });
  });

  group('ChartWidget - Toggle button', () {
    testWidgets('toggle buttons are present and line is selected by default',
        (tester) async {
      when(() => mockBloc.state).thenReturn(const InsufficientData(
        chartType: ChartType.line,
        duration: TimeDuration.twentyFourHour,
      ));

      await tester.pumpWidget(buildTestWidget(mockBloc));

      // Find ToggleButtons specifically
      expect(find.byType(ToggleButtons), findsOneWidget);

      final toggleButtons = tester.widget<ToggleButtons>(
        find.byType(ToggleButtons),
      );
      expect(toggleButtons.isSelected, [true, false]);
    });

    testWidgets('toggle shows candlestick selected when state is candlestick',
        (tester) async {
      when(() => mockBloc.state).thenReturn(const InsufficientData(
        chartType: ChartType.candlestick,
        duration: TimeDuration.twentyFourHour,
      ));

      await tester.pumpWidget(buildTestWidget(mockBloc));

      final toggleButtons = tester.widget<ToggleButtons>(
        find.byType(ToggleButtons),
      );
      expect(toggleButtons.isSelected, [false, true]);
    });

    testWidgets('tapping candlestick icon dispatches ToggleChartType event',
        (tester) async {
      when(() => mockBloc.state).thenReturn(const InsufficientData(
        chartType: ChartType.line,
        duration: TimeDuration.twentyFourHour,
      ));

      await tester.pumpWidget(buildTestWidget(mockBloc));

      // Find the candlestick icon within the ToggleButtons
      final candlestickIcon = find.descendant(
        of: find.byType(ToggleButtons),
        matching: find.byIcon(Icons.candlestick_chart),
      );
      await tester.tap(candlestickIcon);

      verify(() => mockBloc.add(const ToggleChartType())).called(1);
    });

    testWidgets('tapping line icon dispatches ToggleChartType when candlestick is active',
        (tester) async {
      when(() => mockBloc.state).thenReturn(const InsufficientData(
        chartType: ChartType.candlestick,
        duration: TimeDuration.twentyFourHour,
      ));

      await tester.pumpWidget(buildTestWidget(mockBloc));

      // Find the line icon within the ToggleButtons
      final lineIcon = find.descendant(
        of: find.byType(ToggleButtons),
        matching: find.byIcon(Icons.show_chart),
      );
      await tester.tap(lineIcon);

      verify(() => mockBloc.add(const ToggleChartType())).called(1);
    });

    testWidgets('tapping already-selected type does NOT dispatch event',
        (tester) async {
      when(() => mockBloc.state).thenReturn(const InsufficientData(
        chartType: ChartType.line,
        duration: TimeDuration.twentyFourHour,
      ));

      await tester.pumpWidget(buildTestWidget(mockBloc));

      // Tap line icon when already on line - should NOT toggle
      final lineIcon = find.descendant(
        of: find.byType(ToggleButtons),
        matching: find.byIcon(Icons.show_chart),
      );
      await tester.tap(lineIcon);

      verifyNever(() => mockBloc.add(const ToggleChartType()));
    });
  });

  group('ChartWidget - ChartLoaded state (with valid candles)', () {
    testWidgets(
        'shows insufficient data when loaded candles are all invalid (high < low)',
        (tester) async {
      when(() => mockBloc.state).thenReturn(ChartLoaded(
        candles: [
          OhlcCandle(
            timestamp: DateTime(2024, 1, 1),
            open: 100,
            high: 90, // invalid
            low: 95,
            close: 102,
            volume: 1000,
          ),
          OhlcCandle(
            timestamp: DateTime(2024, 1, 1, 1),
            open: 101,
            high: 85, // invalid
            low: 96,
            close: 103,
            volume: 1100,
          ),
          OhlcCandle(
            timestamp: DateTime(2024, 1, 1, 2),
            open: 102,
            high: 80, // invalid
            low: 97,
            close: 104,
            volume: 1200,
          ),
        ],
        chartType: ChartType.line,
        duration: TimeDuration.twentyFourHour,
      ));

      await tester.pumpWidget(buildTestWidget(mockBloc));

      expect(find.text('Insufficient data'), findsOneWidget);
    });
  });

  group('ChartWidget - Unit tests for logic', () {
    test('filter removes invalid OHLC candles (high < low)', () {
      final candles = [
        OhlcCandle(
          timestamp: DateTime(2024, 1, 1),
          open: 100,
          high: 90, // invalid
          low: 95,
          close: 102,
          volume: 1000,
        ),
        OhlcCandle(
          timestamp: DateTime(2024, 1, 1, 1),
          open: 101,
          high: 110, // valid
          low: 96,
          close: 103,
          volume: 1100,
        ),
        OhlcCandle(
          timestamp: DateTime(2024, 1, 1, 2),
          open: 102,
          high: 80, // invalid
          low: 97,
          close: 104,
          volume: 1200,
        ),
        OhlcCandle(
          timestamp: DateTime(2024, 1, 1, 3),
          open: 103,
          high: 115, // valid
          low: 98,
          close: 105,
          volume: 1300,
        ),
      ];

      final valid = candles.where((c) => c.high >= c.low).toList();
      expect(valid.length, 2);
      expect(valid[0].timestamp, DateTime(2024, 1, 1, 1));
      expect(valid[1].timestamp, DateTime(2024, 1, 1, 3));
    });

    test('bullish candle: close > open', () {
      final candle = OhlcCandle(
        timestamp: DateTime(2024, 1, 1),
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1000,
      );
      expect(candle.close > candle.open, isTrue);
    });

    test('bearish candle: close < open', () {
      final candle = OhlcCandle(
        timestamp: DateTime(2024, 1, 1),
        open: 105,
        high: 110,
        low: 95,
        close: 100,
        volume: 1000,
      );
      expect(candle.close < candle.open, isTrue);
    });

    test('candlestick geometry: body top = max(open,close), body bottom = min(open,close)',
        () {
      final bullish = OhlcCandle(
        timestamp: DateTime(2024, 1, 1),
        open: 100,
        high: 110,
        low: 90,
        close: 105,
        volume: 1000,
      );

      final bodyTop = bullish.open > bullish.close ? bullish.open : bullish.close;
      final bodyBottom = bullish.open < bullish.close ? bullish.open : bullish.close;

      expect(bodyTop, 105.0); // max(100, 105)
      expect(bodyBottom, 100.0); // min(100, 105)
      expect(bullish.high, 110.0); // wick top
      expect(bullish.low, 90.0); // wick bottom

      final bearish = OhlcCandle(
        timestamp: DateTime(2024, 1, 1),
        open: 105,
        high: 110,
        low: 90,
        close: 100,
        volume: 1000,
      );

      final bearBodyTop = bearish.open > bearish.close ? bearish.open : bearish.close;
      final bearBodyBottom = bearish.open < bearish.close ? bearish.open : bearish.close;

      expect(bearBodyTop, 105.0); // max(105, 100)
      expect(bearBodyBottom, 100.0); // min(105, 100)
      expect(bearish.high, 110.0); // wick top
      expect(bearish.low, 90.0); // wick bottom
    });
  });
}
