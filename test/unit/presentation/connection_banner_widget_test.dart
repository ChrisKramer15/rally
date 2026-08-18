import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:rally/domain/models/enums.dart';
import 'package:rally/presentation/widgets/market_data/connection_banner_widget.dart';

void main() {
  Widget buildWidget({
    required ConnectionStatus connectionStatus,
    int? reconnectAttempt,
    DateTime? lastDataReceived,
    VoidCallback? onRetry,
  }) {
    return MaterialApp(
      home: Scaffold(
        body: ConnectionBannerWidget(
          connectionStatus: connectionStatus,
          reconnectAttempt: reconnectAttempt,
          lastDataReceived: lastDataReceived,
          onRetry: onRetry,
        ),
      ),
    );
  }

  group('ConnectionBannerWidget', () {
    testWidgets('returns SizedBox.shrink when connected', (tester) async {
      await tester.pumpWidget(buildWidget(
        connectionStatus: ConnectionStatus.connected,
      ));

      expect(find.byType(SizedBox), findsOneWidget);
      final sizedBox = tester.widget<SizedBox>(find.byType(SizedBox));
      expect(sizedBox.width, 0.0);
      expect(sizedBox.height, 0.0);
    });

    testWidgets('shows warning banner when disconnected', (tester) async {
      await tester.pumpWidget(buildWidget(
        connectionStatus: ConnectionStatus.disconnected,
      ));

      expect(find.text('Live data unavailable'), findsOneWidget);
      expect(find.byIcon(Icons.warning_amber_rounded), findsOneWidget);
    });

    testWidgets('shows last received timestamp when disconnected',
        (tester) async {
      final timestamp = DateTime(2024, 3, 15, 14, 30, 45);

      await tester.pumpWidget(buildWidget(
        connectionStatus: ConnectionStatus.disconnected,
        lastDataReceived: timestamp,
      ));

      expect(find.text('Live data unavailable'), findsOneWidget);
      expect(find.text('Last updated: 14:30:45'), findsOneWidget);
    });

    testWidgets('shows reconnecting indicator with attempt number',
        (tester) async {
      await tester.pumpWidget(buildWidget(
        connectionStatus: ConnectionStatus.reconnecting,
        reconnectAttempt: 3,
      ));

      expect(find.text('Reconnecting... attempt 3/10'), findsOneWidget);
      expect(find.byType(CircularProgressIndicator), findsOneWidget);
    });

    testWidgets('shows default attempt 1 when reconnectAttempt is null',
        (tester) async {
      await tester.pumpWidget(buildWidget(
        connectionStatus: ConnectionStatus.reconnecting,
      ));

      expect(find.text('Reconnecting... attempt 1/10'), findsOneWidget);
    });

    testWidgets('shows persistent error banner when retries exhausted',
        (tester) async {
      await tester.pumpWidget(buildWidget(
        connectionStatus: ConnectionStatus.disconnected,
        reconnectAttempt: 11,
        onRetry: () {},
      ));

      expect(find.text('Connection failed'), findsOneWidget);
      expect(find.text('Retry'), findsOneWidget);
      expect(find.byIcon(Icons.error_outline), findsOneWidget);
    });

    testWidgets('retry button calls onRetry callback', (tester) async {
      var retryCalled = false;

      await tester.pumpWidget(buildWidget(
        connectionStatus: ConnectionStatus.disconnected,
        reconnectAttempt: 11,
        onRetry: () => retryCalled = true,
      ));

      await tester.tap(find.text('Retry'));
      expect(retryCalled, isTrue);
    });

    testWidgets('does not show retry button when onRetry is null',
        (tester) async {
      await tester.pumpWidget(buildWidget(
        connectionStatus: ConnectionStatus.disconnected,
        reconnectAttempt: 11,
      ));

      expect(find.text('Connection failed'), findsOneWidget);
      expect(find.text('Retry'), findsNothing);
    });

    testWidgets('formats single-digit time values with leading zeros',
        (tester) async {
      final timestamp = DateTime(2024, 1, 1, 9, 5, 3);

      await tester.pumpWidget(buildWidget(
        connectionStatus: ConnectionStatus.disconnected,
        lastDataReceived: timestamp,
      ));

      expect(find.text('Last updated: 09:05:03'), findsOneWidget);
    });
  });
}
