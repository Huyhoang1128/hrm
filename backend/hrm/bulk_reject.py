"""Từ chối hàng loạt đơn đang chờ duyệt (nút "Từ chối nhanh" ở trang Phê duyệt).

Mixin cho các ViewSet đơn từ đã có action ``reject(request, pk)`` và
``_base_qs()``: gọi lại đúng ``reject()`` cho từng đơn PENDING, nên mọi kiểm tra
quyền / lịch sử duyệt của từ chối đơn lẻ được áp dụng y hệt.
"""
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response


class BulkRejectMixin:
    @action(detail=False, methods=['post'])
    def bulk_reject(self, request):
        """Body: {"ids": [1, 2, 3], "approval_note": "..."}"""
        ids = request.data.get('ids') or []
        if not isinstance(ids, list) or not ids:
            return Response({'error': 'Danh sách ID không được để trống'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            ids = [int(i) for i in ids]
        except (TypeError, ValueError):
            return Response({'error': 'Danh sách ID không hợp lệ'}, status=status.HTTP_400_BAD_REQUEST)

        results, errors, found = [], [], set()
        events = self._base_qs().filter(id__in=ids).order_by('event_date', 'created_at', 'id')
        for event in events:
            found.add(event.id)
            current = (event.data or {}).get('status')
            if current != 'PENDING':
                errors.append({'id': event.id, 'error': f'Đơn đang ở trạng thái {current}'})
                continue
            response = self.reject(request, pk=event.id)
            if 200 <= response.status_code < 300:
                results.append(event.id)
            else:
                data = getattr(response, 'data', None) or {}
                errors.append({'id': event.id, 'error': data.get('error') if isinstance(data, dict) else str(data)})
        for missing in sorted(set(ids) - found):
            errors.append({'id': missing, 'error': 'Không tìm thấy đơn'})

        return Response({
            'success_count': len(results),
            'error_count': len(errors),
            'results': results,
            'errors': errors,
        })
