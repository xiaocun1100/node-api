const express = require('express');
const cors = require('cors');
const pool = require('./db');
require('dotenv').config();

const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// ----------------------
// 接口 1：测试接口
// ----------------------
app.get('/', (req, res) => {
  res.send('Node + MySQL 后端运行成功！');
});

// ----------------------
// 接口 2：获取所有数据
// ----------------------
app.get('/api/list', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM users');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ message: '查询失败' });
  }
});

// ----------------------
// 接口 3：添加一条数据
// ----------------------
app.post('/api/add', async (req, res) => {
  try {
    const { name, age } = req.body;
    const [result] = await pool.query(
      'INSERT INTO users (name, age) VALUES (?, ?)',
      [name, age]
    );
    res.json({ id: result.insertId, name, age });
  } catch (err) {
    res.status(500).json({ message: '添加失败' });
  }
});

// ----------------------
// 启动服务
// ----------------------
const PORT = process.env.PORT || 3000;
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