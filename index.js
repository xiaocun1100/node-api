const express = require('express');
const cors = require('cors');
const pool = require('./db');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 认证中间件
const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ code: 401, message: '未授权' });
  }
  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, message: 'Token无效' });
  }
};

// 统一响应格式
const success = (data) => ({ code: 200, data });
const error = (message, code = 500) => ({ code, message });

// ----------------------
// 接口 1：登录
// ----------------------
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.json(error('用户名和密码不能为空'));
    }
    const [users] = await pool.query('SELECT * FROM users WHERE username = ? AND status = 1', [username]);
    if (users.length === 0) {
      return res.json(error('用户名或密码错误'));
    }
    const user = users[0];
    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return res.json(error('用户名或密码错误'));
    }
    const [roleRows] = await pool.query('SELECT r.id, r.name, r.code FROM roles r JOIN user_roles ur ON r.id = ur.role_id WHERE ur.user_id = ?', [user.id]);
    const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json(success({
      token,
      user: {
        id: user.id,
        username: user.username,
        nickname: user.nickname,
        email: user.email,
        phone: user.phone,
        avatar: user.avatar,
        status: user.status,
        roles: roleRows
      }
    }));
  } catch (err) {
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 2：获取用户列表
// ----------------------
app.get('/api/users', authenticate, async (req, res) => {
  try {
    const { page = 1, pageSize = 10, keyword = '' } = req.query;
    const offset = (page - 1) * pageSize;
    let where = 'WHERE 1=1';
    const params = [];
    if (keyword) {
      where += ' AND (username LIKE ? OR nickname LIKE ?)';
      params.push(`%${keyword}%`, `%${keyword}%`);
    }
    const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM users ${where}`, params);
    const [rows] = await pool.query(`SELECT * FROM users ${where} LIMIT ? OFFSET ?`, [...params, parseInt(pageSize), offset]);
    for (const user of rows) {
      const [roleRows] = await pool.query('SELECT role_id FROM user_roles WHERE user_id = ?', [user.id]);
      user.roleIds = roleRows.map(r => r.role_id);
      delete user.password;
    }
    res.json(success({ list: rows, total }));
  } catch (err) {
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 3：新增用户
// ----------------------
app.post('/api/users', authenticate, async (req, res) => {
  try {
    const { username, nickname, email, phone, status = 1, roleIds = [] } = req.body;
    if (!username) {
      return res.json(error('用户名不能为空'));
    }
    const password = await bcrypt.hash('123456', 10);
    const [result] = await pool.query(
      'INSERT INTO users (username, nickname, email, phone, password, status) VALUES (?, ?, ?, ?, ?, ?)',
      [username, nickname, email, phone, password, status]
    );
    if (roleIds.length > 0) {
      for (const roleId of roleIds) {
        await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [result.insertId, roleId]);
      }
    }
    res.json(success({ id: result.insertId }));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.json(error('用户名已存在'));
    }
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 4：编辑用户
// ----------------------
app.put('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { username, nickname, email, phone, status, roleIds } = req.body;
    await pool.query(
      'UPDATE users SET username = ?, nickname = ?, email = ?, phone = ?, status = ? WHERE id = ?',
      [username, nickname, email, phone, status, id]
    );
    if (roleIds !== undefined) {
      await pool.query('DELETE FROM user_roles WHERE user_id = ?', [id]);
      for (const roleId of roleIds) {
        await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)', [id, roleId]);
      }
    }
    res.json(success({ message: '更新成功' }));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.json(error('用户名已存在'));
    }
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 5：删除用户
// ----------------------
app.delete('/api/users/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM user_roles WHERE user_id = ?', [id]);
    await pool.query('DELETE FROM users WHERE id = ?', [id]);
    res.json(success({ message: '删除成功' }));
  } catch (err) {
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 6：获取所有角色（下拉框）
// ----------------------
app.get('/api/roles/all', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, name FROM roles WHERE status = 1');
    res.json(success(rows));
  } catch (err) {
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 7：获取角色列表
// ----------------------
app.get('/api/roles', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM roles ORDER BY id');
    for (const role of rows) {
      const [menuRows] = await pool.query('SELECT menu_id FROM role_menus WHERE role_id = ?', [role.id]);
      role.menuIds = menuRows.map(m => m.menu_id);
    }
    res.json(success(rows));
  } catch (err) {
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 8：新增角色
// ----------------------
app.post('/api/roles', authenticate, async (req, res) => {
  try {
    const { name, code, description, status = 1, menuIds = [] } = req.body;
    if (!name || !code) {
      return res.json(error('角色名称和编码不能为空'));
    }
    const [result] = await pool.query(
      'INSERT INTO roles (name, code, description, status) VALUES (?, ?, ?, ?)',
      [name, code, description, status]
    );
    for (const menuId of menuIds) {
      await pool.query('INSERT INTO role_menus (role_id, menu_id) VALUES (?, ?)', [result.insertId, menuId]);
    }
    res.json(success({ id: result.insertId }));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.json(error('角色编码已存在'));
    }
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 9：编辑角色
// ----------------------
app.put('/api/roles/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description, status, menuIds } = req.body;
    await pool.query(
      'UPDATE roles SET name = ?, code = ?, description = ?, status = ? WHERE id = ?',
      [name, code, description, status, id]
    );
    if (menuIds !== undefined) {
      await pool.query('DELETE FROM role_menus WHERE role_id = ?', [id]);
      for (const menuId of menuIds) {
        await pool.query('INSERT INTO role_menus (role_id, menu_id) VALUES (?, ?)', [id, menuId]);
      }
    }
    res.json(success({ message: '更新成功' }));
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.json(error('角色编码已存在'));
    }
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 10：删除角色
// ----------------------
app.delete('/api/roles/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM role_menus WHERE role_id = ?', [id]);
    await pool.query('DELETE FROM user_roles WHERE role_id = ?', [id]);
    await pool.query('DELETE FROM roles WHERE id = ?', [id]);
    res.json(success({ message: '删除成功' }));
  } catch (err) {
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 11：获取菜单列表
// ----------------------
app.get('/api/menus', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM menus WHERE status = 1 ORDER BY order_num');
    const buildTree = (parentId) => {
      return rows.filter(r => r.parent_id === parentId).map(r => ({
        id: r.id,
        name: r.name,
        path: r.path,
        icon: r.icon,
        parentId: r.parent_id,
        orderNum: r.order_num,
        type: r.type,
        permission: r.permission,
        status: r.status,
        children: buildTree(r.id)
      }));
    };
    res.json(success(buildTree(null)));
  } catch (err) {
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 12：获取所有菜单（下拉框）
// ----------------------
app.get('/api/menus/all', authenticate, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT id, parent_id, name FROM menus ORDER BY order_num');
    res.json(success(rows));
  } catch (err) {
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 13：新增菜单
// ----------------------
app.post('/api/menus', authenticate, async (req, res) => {
  try {
    const { name, path, icon, parentId, orderNum = 0, type = 0, permission, status = 1 } = req.body;
    if (!name) {
      return res.json(error('菜单名称不能为空'));
    }
    const [result] = await pool.query(
      'INSERT INTO menus (name, path, icon, parent_id, order_num, type, permission, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, path, icon, parentId || null, orderNum, type, permission, status]
    );
    res.json(success({ id: result.insertId }));
  } catch (err) {
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 14：编辑菜单
// ----------------------
app.put('/api/menus/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, path, icon, parentId, orderNum, type, permission, status } = req.body;
    await pool.query(
      'UPDATE menus SET name = ?, path = ?, icon = ?, parent_id = ?, order_num = ?, type = ?, permission = ?, status = ? WHERE id = ?',
      [name, path, icon, parentId || null, orderNum, type, permission, status, id]
    );
    res.json(success({ message: '更新成功' }));
  } catch (err) {
    res.json(error(err.message));
  }
});

// ----------------------
// 接口 15：删除菜单
// ----------------------
app.delete('/api/menus/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const [children] = await pool.query('SELECT id FROM menus WHERE parent_id = ?', [id]);
    if (children.length > 0) {
      return res.json(error('请先删除子菜单'));
    }
    await pool.query('DELETE FROM role_menus WHERE menu_id = ?', [id]);
    await pool.query('DELETE FROM menus WHERE id = ?', [id]);
    res.json(success({ message: '删除成功' }));
  } catch (err) {
    res.json(error(err.message));
  }
});

// ----------------------
// 启动服务
// ----------------------
const PORT = process.env.SERVER_PORT || 3000;
console.log('Starting server on port:', PORT);
app.listen(PORT, () => {
  console.log(`服务运行在 http://localhost:${PORT}`);
});

async function testConn() {
  try {
    const [rows] = await pool.query('SELECT DATABASE()');
    console.log('当前连接的数据库：', rows[0]['DATABASE()']);
    const [tables] = await pool.query('SHOW TABLES');
    console.log('数据库中的表：', tables);
  } catch (err) {
    console.error('连接失败：', err);
  }
}
testConn();