const express = require('express');
const Contact = require('../repositories/contact');

const router = express.Router();

const escapeRegex = (input = '') => input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

router.get('/', async (req, res) => {
  try {
    const {
      q = '',
      tags = '',
      assignedAgent = '',
      lastSeenFrom = '',
      lastSeenTo = '',
      page = '1',
      limit = '25',
      sort = 'lastSeen_desc',
      tagMode = 'all',
    } = req.query;

    const query = {};
    const trimmedSearch = String(q || '').trim();
    const tagList = String(tags || '')
      .split(',')
      .map((tag) => tag.trim().toLowerCase())
      .filter(Boolean);

    if (trimmedSearch) {
      const searchRegex = new RegExp(escapeRegex(trimmedSearch), 'i');
      query.$or = [{ phone: searchRegex }, { name: searchRegex }, { tags: searchRegex }];
    }

    if (tagList.length > 0) {
      query.tags = String(tagMode).toLowerCase() === 'any' ? { $in: tagList } : { $all: tagList };
    }

    if (assignedAgent) {
      query.assignedAgent = String(assignedAgent).trim();
    }

    if (lastSeenFrom || lastSeenTo) {
      query.lastSeen = {};
      if (lastSeenFrom) {
        const parsed = new Date(lastSeenFrom);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ success: false, error: 'Invalid lastSeenFrom date' });
        }
        query.lastSeen.$gte = parsed;
      }
      if (lastSeenTo) {
        const parsed = new Date(lastSeenTo);
        if (Number.isNaN(parsed.getTime())) {
          return res.status(400).json({ success: false, error: 'Invalid lastSeenTo date' });
        }
        query.lastSeen.$lte = parsed;
      }
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 25));
    const skip = (safePage - 1) * safeLimit;
    const sortMap = {
      lastSeen_desc: { lastSeen: -1, updatedAt: -1 },
      lastSeen_asc: { lastSeen: 1, updatedAt: 1 },
      name_asc: { name: 1, phone: 1 },
      name_desc: { name: -1, phone: -1 },
    };

    const [data, total] = await Promise.all([
      Contact.find(query).sort(sortMap[sort] || sortMap.lastSeen_desc).skip(skip).limit(safeLimit).lean(),
      Contact.countDocuments(query),
    ]);

    return res.json({
      success: true,
      data,
      pagination: {
        page: safePage,
        limit: safeLimit,
        total,
        pages: Math.ceil(total / safeLimit),
      },
    });
  } catch (err) {
    console.error('[contacts] list error', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch contacts' });
  }
});

router.get('/:phone', async (req, res) => {
  try {
    const phone = String(req.params.phone || '').replace(/\D/g, '');
    const contact = await Contact.findOne({ phone }).lean();
    if (!contact) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }
    return res.json({ success: true, data: contact });
  } catch (err) {
    console.error('[contacts] fetch error', err);
    return res.status(500).json({ success: false, error: 'Failed to fetch contact' });
  }
});

router.patch('/:phone', async (req, res) => {
  try {
    const phone = String(req.params.phone || '').replace(/\D/g, '');
    const { name, tags, addTags, removeTags, customFields, assignedAgent } = req.body || {};

    if (!phone) {
      return res.status(400).json({ success: false, error: 'Invalid phone' });
    }

    const setUpdate = {};
    if (typeof name === 'string') setUpdate.name = name.trim();
    if (Array.isArray(tags)) {
      setUpdate.tags = [...new Set(tags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean))];
    }
    if (customFields && typeof customFields === 'object' && !Array.isArray(customFields)) {
      setUpdate.customFields = customFields;
    }
    if (typeof assignedAgent === 'string') setUpdate.assignedAgent = assignedAgent.trim();

    const update = {};
    if (Object.keys(setUpdate).length > 0) {
      update.$set = setUpdate;
    }
    if (Array.isArray(addTags) && addTags.length > 0) {
      update.$addToSet = {
        tags: { $each: addTags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean) },
      };
    }
    if (Array.isArray(removeTags) && removeTags.length > 0) {
      update.$pull = {
        tags: { $in: removeTags.map((tag) => String(tag || '').trim().toLowerCase()).filter(Boolean) },
      };
    }

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    const contact = await Contact.findOneAndUpdate({ phone }, update, { new: true }).lean();
    if (!contact) {
      return res.status(404).json({ success: false, error: 'Contact not found' });
    }

    return res.json({ success: true, data: contact });
  } catch (err) {
    console.error('[contacts] update error', err);
    return res.status(500).json({ success: false, error: 'Failed to update contact' });
  }
});

module.exports = router;
